import { join } from "node:path";

let readiness: Promise<void> | undefined;

/** PDF.js uses these generic families for fonts that a PDF does not embed. */
export function ensurePdfFonts(): Promise<void> {
  return readiness ??= (async () => {
    const { GlobalFonts } = await import("@napi-rs/canvas");
    for (const [family, file, fallback] of [
      ["Noto Sans JP", "NotoSansJP.ttf", "sans-serif"],
      ["Noto Serif JP", "NotoSerifJP.ttf", "serif"],
    ]) {
      const registered = GlobalFonts.registerFromPath(join(process.cwd(), "assets/pdf-fonts", file));
      if (!registered || !GlobalFonts.setAlias(family, fallback)) {
        throw new Error("PDFの日本語フォントを読み込めませんでした。ページの画像化を再試行してください。");
      }
    }
  })().catch(error => { readiness = undefined; throw error; });
}
