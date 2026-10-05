import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { dirname, join } from "node:path";
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_CHARACTERS, DOCUMENT_MAX_UNITS, type SourceDocument, type SourceUnit } from "./source-document";

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

export async function parseSourceDocument(name: string, bytes: Buffer): Promise<SourceDocument> {
  if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES) throw new Error("8MBまでのExcelまたはPDFを選んでください。");
  const format = name.toLowerCase().endsWith(".xlsx") ? "xlsx" : name.toLowerCase().endsWith(".pdf") ? "pdf" : null;
  if (!format) throw new Error("Excelは.xlsx、PDFは.pdf形式を選んでください。マクロや外部リンクは実行しません。");
  const units: SourceUnit[] = [], warnings: string[] = [];
  let characters = 0;
  const append = (unit: SourceUnit) => {
    characters += unit.text.length;
    if (units.length >= DOCUMENT_MAX_UNITS || characters > DOCUMENT_MAX_CHARACTERS) throw new Error("読み込める量を超えています。対象の業務・シート・ページを別ファイルに分けてください。途中までの内容は取り込みません。");
    units.push(unit);
  };
  if (format === "xlsx") {
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
    if (bytes.subarray(0,5).toString() !== "%PDF-") throw new Error("PDFファイルを読み取れません。");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Use the native module at runtime; a bundler's require.resolve returns a module ID.
    const nativeRequire = process.getBuiltinModule("module").createRequire(join(process.cwd(), "package.json"));
    const pdfRoot = dirname(nativeRequire.resolve("pdfjs-dist/package.json"));
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false,
      cMapUrl: join(pdfRoot,"cmaps").replaceAll("\\", "/")+"/", cMapPacked: true, standardFontDataUrl: join(pdfRoot,"standard_fonts").replaceAll("\\", "/")+"/" });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 80) throw new Error("PDFは80ページまでです。対象のページを別ファイルにしてください。");
      const empty: number[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p), content = await page.getTextContent();
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
        else append({ id: `page-${p}`, page: p, location: `PDF ${p}ページ`, text: lines.map(line => line.items.sort((a,b) => a.x-b.x).map(item => item.text).join("　")).join("\n") });
        page.cleanup();
      }
      if (empty.length) warnings.push(`文字を読み取れないページ：${empty.join("、")}。スキャン画像はOCRに対応していないため、内容を取り込んでいません。`);
      warnings.push("PDFの文字とページ位置を読みました。図・矢印・写真の内容は読み取っていません。表の列の対応は元ページで確認してください。");
    } finally { await task.destroy(); }
  }
  if (!units.length) throw new Error("読み取れる文字がありません。スキャンPDFは文字認識（OCR）を行ったPDFにしてから選んでください。");
  return { id: randomUUID(), name: name.replace(/[\r\n]/g," ").slice(0,200), format, sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length, createdAt: new Date().toISOString(), units, warnings };
}
