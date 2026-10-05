import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import type { SourceImage } from "./source-document";

export const VISUAL_DOCUMENT_MAX_PAGES = 80;
export class OfficeRenderError extends Error {}

/** Office is a server-side renderer. Neither the user's Office nor their profile is opened. */
export async function renderOfficePDF(bytes: Buffer, format: "docx" | "pptx"): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "business-document-render-"));
  const profile = join(directory, "profile");
  try {
    await mkdir(join(profile, "user"), { recursive: true });
    // Highest macro security, fresh profile with no trusted locations.
    await writeFile(join(profile, "user", "registrymodifications.xcu"), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
    const source = join(directory, `source.${format}`);
    await writeFile(source, bytes);
    const command = process.env.BFL_OFFICE_RENDERER || (process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.com" : "soffice");
    if (process.platform === "win32" || command.includes("/")) {
      try { await access(command); } catch { throw new OfficeRenderError("Word・PowerPointのページを画像に変換できません。元資料は保存されています。変換用のLibreOfficeを設定して再試行するか、PDFに保存して読み込めます。"); }
    }
    await runRenderer(command, [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--nologo", "--nodefault", "--norestore", "--convert-to", "pdf", "--outdir", directory, source], directory);
    const pdf = await readFile(join(directory, "source.pdf"));
    if (pdf.length > 24 * 1024 * 1024) throw new OfficeRenderError("画像にした資料が大きすぎます。対象のページを分けて読み込んでください。元資料は保存されています。");
    return pdf;
  } catch (error) {
    if (error instanceof OfficeRenderError) throw error;
    throw new OfficeRenderError("Word・PowerPointのページを画像に変換できませんでした。元資料は保存されています。PDFに保存した資料でも読み込めます。");
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}

function runRenderer(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: "ignore" });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Only terminate the process tree we started. Office's child must not keep a file handle.
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else child.kill();
      child.once("close", () => reject(new OfficeRenderError("ページの変換に時間がかかりすぎています。元資料は保存されています。対象のページを分けて再試行できます。")));
    }, 45_000);
    child.once("error", () => { clearTimeout(timer); if (!settled) { settled = true; reject(new OfficeRenderError("ページの変換用プログラムを起動できません。元資料は保存されています。変換の設定を確認して再試行できます。")); } });
    child.once("close", code => { clearTimeout(timer); if (!settled) { settled = true; code === 0 ? resolve() : reject(new OfficeRenderError("ページを変換できませんでした。元資料は保存されています。暗号化や破損のない資料で再試行できます。")); } });
  });
}

/** Keep uploaded bytes unchanged; this bounded reading copy is only for previews/vision. */
export async function normalizeSourceImage(unitId: string, bytes: Buffer): Promise<SourceImage> {
  try {
    const input = sharp(bytes, { limitInputPixels: 20_000_000, animated: false });
    const metadata = await input.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1)>1 || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("format");
    const { data, info } = await input.rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    return { unitId, bytes: data, mimeType: "image/jpeg", width: info.width, height: info.height };
  } catch { throw new Error("画像を読み取れません。PNG・JPEG・WebPの静止画像で、2000万画素までの画像を選んでください。"); }
}
