import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { dirname, join } from "node:path";
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_CHARACTERS, DOCUMENT_MAX_UNITS, PDF_RENDER_VERSION, type SourceDocument, type SourceUnit, type SourceImage } from "./source-document";
import { normalizeSourceImage, OfficeRenderError, renderOfficePDF, VISUAL_DOCUMENT_MAX_PAGES } from "./document-renderer";

/** Check declared expansion before a workbook library decompresses it. ZIP64 is intentionally unsupported. */
export function checkWorkbookArchive(bytes: Buffer): void {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Excelファイルを読み取れません。xlsx形式で保存し直してください。");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16), total = 0;
  if (count === 65535 || count > 4096 || offset === 0xffffffff) throw new Error("Excelの内部ファイル数が読み込み上限を超えています。対象のシートを別ファイルにしてください。");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Excelファイルの構造を読み取れません。");
    const size = bytes.readUInt32LE(offset + 24); total += size;
    if (size > 16 * 1024 * 1024 || total > 32 * 1024 * 1024 || bytes.readUInt16LE(offset + 8) & 1) throw new Error("Excelの展開後のサイズが大きすぎるか、暗号化されています。対象のシートを通常のxlsxへ保存してください。");
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

export function sourceDocumentMetadata(name: string, bytes: Buffer): SourceDocument {
  if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES) throw new Error("8MBまでの資料を選んでください。");
  const extension = name.toLowerCase().split(".").at(-1);
  const format = extension === "jpg" || extension === "jpeg" ? "jpeg" : ["xlsx", "pdf", "docx", "pptx", "png", "webp"].includes(extension ?? "") ? extension as SourceDocument["format"] : null;
  if (!format) throw new Error(".xlsx・.pdf・.docx・.pptx・PNG・JPEG・WebPの資料を選んでください。マクロは実行しません。");
  return { id: randomUUID(), name: name.replace(/[\r\n]/g, " ").slice(0,200), format, sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length, createdAt: new Date().toISOString(), units: [], warnings: [], rendering: { status: "pending" } };
}

export async function parseSourceDocument(name: string, bytes: Buffer, options?: { onImage: (image: SourceImage) => void }): Promise<SourceDocument> {
  const metadata = sourceDocumentMetadata(name, bytes), format = metadata.format;
  const units: SourceUnit[] = [], warnings: string[] = [];
  let rendering: SourceDocument["rendering"];
  let characters = 0;
  let imageBytes = 0;
  const append = (unit: SourceUnit) => {
    characters += unit.text.length;
    if (units.length >= DOCUMENT_MAX_UNITS || characters > DOCUMENT_MAX_CHARACTERS) throw new Error("読み込める量を超えています。対象の業務・シート・ページを別ファイルに分けてください。途中までの内容は取り込みません。");
    units.push(unit);
  };
  if (["png", "jpeg", "webp"].includes(format)) {
    const expected = format === "png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : format === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP";
    if (!expected) throw new Error("画像の形式とファイル名が一致しません。PNG・JPEG・WebPとして保存し直してください。");
    const image = await normalizeSourceImage("image-1", bytes);
    options?.onImage(image);
    append({ id: image.unitId, location: "画像 1", text: "", ...(options ? { image: { width: image.width, height: image.height, mimeType: image.mimeType } } : {}) });
    warnings.push("画像の文字・図・矢印はAIが読み取ります。読取りは推定として残し、元画像で確かめられます。");
  } else if (format === "xlsx") {
    checkWorkbookArchive(bytes);
    // Some valid OOXML writers use x:workbook/x:worksheet. ExcelJS expects unprefixed
    // spreadsheet element names. Normalize only that namespace in a reading copy.
    const zip = await JSZip.loadAsync(bytes);
    let normalized = false;
    for (const entry of Object.values(zip.files)) {
      if (!/^xl\/(?:workbook|styles|sharedStrings|worksheets\/[^/]+)\.xml$/.test(entry.name)) continue;
      let xml = await entry.async("string");
      const prefixes = [...xml.matchAll(/xmlns:(\w+)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/g)].map(match => match[1]);
      for (const prefix of new Set(prefixes)) xml = xml.replace(new RegExp(`<(/?)${prefix}:`, "g"), "<$1");
      if (prefixes.length) { zip.file(entry.name, xml); normalized = true; }
    }
    const readingBytes = normalized ? await zip.generateAsync({ type: "nodebuffer" }) : bytes;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readingBytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    if (workbook.worksheets.length > 40) throw new Error("シート数が40を超えています。対象のシートを別ファイルにしてください。");
    let formulas = 0, hidden = 0;
    for (const [index, sheet] of workbook.worksheets.entries()) {
      if (sheet.rowCount > 5000 || sheet.columnCount > 128) throw new Error("Excelの行・列が読み込み上限を超えています。対象の表を別シートにしてください。");
      if (sheet.state !== "visible") hidden++;
      sheet.eachRow({ includeEmpty: false }, row => {
        const cells: NonNullable<SourceUnit["cells"]> = [];
        // Repeated merged values retain their master address; they are not new facts.
        row.eachCell({ includeEmpty: true }, cell => {
          const master = cell.isMerged ? cell.master : cell;
          const value = master.value;
          let text = master.text ?? "";
          if (value instanceof Date) text = value.toISOString().slice(0,10);
          else if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
            formulas++;
            text = "result" in value && value.result != null ? String(value.result) : "[数式の表示値なし・未確認]";
          }
          if (typeof master.note === "string" && master.note) text += ` 注記：${master.note}`;
          else if (master.note && typeof master.note === "object") text += ` 注記：${master.note.texts?.map(t => t.text).join("") ?? ""}`;
          cells.push({ address: cell.address, sourceAddress: master.address, text });
        });
        if (!cells.some(cell => cell.text.trim())) return;
        append({ id: `sheet-${index + 1}-row-${row.number}`, sheet: sheet.name, row: row.number, location: `${sheet.name}!${cells[0].address}:${cells.at(-1)!.address}`, cells,
          text: cells.map(cell => `${cell.address}${cell.sourceAddress !== cell.address ? `（結合元${cell.sourceAddress}）` : ""}=${cell.text || "[空欄]"}`).join(" | ") });
      });
    }
    warnings.push("セルの文字・注記・結合セルを読みました。画像、図形、矢印、埋め込みファイルの内容は読み取っていません。");
    if (formulas) warnings.push("数式は再計算せず、保存済みの表示値を読みました。値がない数式は未確認として残します。");
    if (hidden) warnings.push(`非表示の${hidden}シートも読み込み対象に含めています。`);
  } else {
    let pdfBytes = bytes;
    if (format === "docx" || format === "pptx") {
      try { checkWorkbookArchive(bytes); } catch (error) { throw new Error((error instanceof Error ? error.message : "資料を読み取れません。").replaceAll("Excel", format === "docx" ? "Word" : "PowerPoint").replaceAll("xlsx", format)); }
      const zip = await JSZip.loadAsync(bytes);
      if (!zip.file(format === "docx" ? "word/document.xml" : "ppt/presentation.xml")) throw new Error("Word・PowerPointの構造を読み取れません。");
      for (const entry of Object.values(zip.files)) {
        if (/vbaProject/i.test(entry.name)) throw new Error("マクロを含む資料は読み込みません。マクロを除いた.docx・.pptxかPDFとして保存してください。");
        if (entry.name.endsWith(".rels")) {
          const xml = await entry.async("string");
          for (const relationship of xml.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)) if (/TargetMode\s*=/i.test(relationship[0]) && !/TargetMode\s*=\s*["']Internal["']/i.test(relationship[0]) && !/Type\s*=\s*["'][^"']+\/hyperlink["']/.test(relationship[0]))
            throw new Error("外部のファイルを参照する資料です。参照を埋め込んだWord・PowerPointかPDFを読み込んでください。外部ファイルは取得しません。");
        }
      }
      try { pdfBytes = await renderOfficePDF(bytes, format); rendering = { status: "ready" }; }
      catch (error) { if (!(error instanceof OfficeRenderError)) throw error; rendering = { status: "unavailable", message: error.message }; warnings.push(error.message); }
      warnings.push("Wordのコメント・変更履歴、PowerPointの発表者ノートは読取り対象外です。元のファイルも保存しています。");
    }
    if (rendering?.status !== "unavailable") {
    if (pdfBytes.subarray(0,5).toString() !== "%PDF-") throw new Error("PDFファイルを読み取れません。");
    if (options) await (await import("./pdf-fonts")).ensurePdfFonts();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Use the native module at runtime; a bundler's require.resolve returns a module ID.
    const nativeRequire = process.getBuiltinModule("module").createRequire(join(process.cwd(), "package.json"));
    const pdfRoot = dirname(nativeRequire.resolve("pdfjs-dist/package.json"));
    const task = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false,maxImageSize:20_000_000,canvasMaxAreaInBytes:20*1024*1024,
      cMapUrl: join(pdfRoot,"cmaps").replaceAll("\\", "/")+"/", cMapPacked: true, standardFontDataUrl: join(pdfRoot,"standard_fonts").replaceAll("\\", "/")+"/" });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > (options ? VISUAL_DOCUMENT_MAX_PAGES : 80)) throw new Error(`図も読み取る資料は${VISUAL_DOCUMENT_MAX_PAGES}ページまでです。対象のページを別ファイルにしてください。`);
      const empty: number[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p), content = await page.getTextContent();
        if(content.items.length>20_000)throw new Error("1ページの文字が多すぎます。対象の表やページを分けて読み込んでください。元資料は保存されています。");
        const lines: Array<{ y: number; items: Array<{x:number; text:string}> }> = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const y = item.transform[5], x = item.transform[4];
          let line = lines.find(line => Math.abs(line.y - y) < 2);
          if (!line) { line = { y, items: [] }; lines.push(line); }
          line.items.push({ x, text: item.str });
        }
        lines.sort((a,b) => b.y - a.y);
        if (!lines.length) empty.push(p);
        const unit: SourceUnit = { id: `page-${p}`, page: p, location: format === "pptx" ? `スライド ${p}` : `${format === "docx" ? "Word" : "PDF"} ${p}ページ`, text: lines.map(line => line.items.sort((a,b) => a.x-b.x).map(item => item.text).join("　")).join("\n") };
        if (options) {
          const { createCanvas } = await import("@napi-rs/canvas");
          const originalViewport = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2.5, 1800 / Math.max(originalViewport.width, originalViewport.height)) });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvas: null, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
          const image = await normalizeSourceImage(unit.id, canvas.toBuffer("image/png"));
          imageBytes += image.bytes.length;
          if (imageBytes > 48 * 1024 * 1024) throw new Error("ページ画像の合計が48MBを超えています。対象のページを分けて読み込んでください。");
          unit.image = { width: image.width, height: image.height, mimeType: image.mimeType };
          options.onImage(image);
        }
        if (lines.length || options) append(unit);
        page.cleanup();
      }
      if (empty.length) warnings.push(options ? `画像として読むページ：${empty.join("、")}。抽出できる文字がないため、AIの読取りを元画像で確認してください。` : `文字を読み取れないページ：${empty.join("、")}。画像としての読取りはまだ行っていません。`);
      warnings.push(options ? "ページを画像にして保存しました。文字・図・矢印をAIが読み取り、推定として残します。表の列や分岐を元ページで確かめられます。" : "PDFの文字とページ位置を読みました。図・矢印・写真の内容は読み取っていません。表の列の対応は元ページで確認してください。");
    } finally { await task.destroy(); }
    }
  }
  if (!units.length && rendering?.status !== "unavailable") throw new Error("読み取れる文字がありません。画像を含めた読取りを試してください。");
  const finalRendering: NonNullable<SourceDocument["rendering"]> = rendering ?? { status: "ready" };
  if (format === "pdf" && options && finalRendering.status === "ready") finalRendering.version = PDF_RENDER_VERSION;
  return { ...metadata, units, warnings, rendering: finalRendering };
}
