import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";
import path from "node:path";
import ExcelJS from "exceljs";

test("updated archive dependencies preserve a streamed Excel workbook and its Japanese values", { timeout: 10000 }, async () => {
  const output = new PassThrough(), chunks: Buffer[] = [];
  output.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>((resolve, reject) => { output.once("end", resolve); output.once("error", reject); });
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useSharedStrings: false });
  const sheet = writer.addWorksheet("監査の仕事");
  sheet.addRow(["担当", "仕事", "未確認"]).commit();
  sheet.addRow(["分析担当", "標準試料を確認する", "承認の記録先"]).commit();
  await writer.commit();
  await finished;
  const bytes = Buffer.concat(chunks);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([bytes]));
  assert.equal(workbook.getWorksheet("監査の仕事")!.getCell("B2").value, "標準試料を確認する");
  const rows: unknown[][] = [];
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([bytes]), { sharedStrings: "cache", worksheets: "emit" });
  for await (const worksheet of reader) for await (const row of worksheet) rows.push(row.values as unknown[]);
  assert.ok(rows.some(row => row[1] === "分析担当" && row[3] === "承認の記録先"), JSON.stringify(rows));
});

test("updated CSV and glob dependencies retain ExcelJS escaping and file lookup contracts", { timeout: 10000 }, async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("試薬");
  sheet.addRow(["品名", "補足"]);
  sheet.addRow(["試薬,標準品", "確認\n未完了"]);
  const csv = await workbook.csv.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.csv.read(Readable.from([csv]));
  assert.equal(restored.worksheets[0].getCell("A2").value, "試薬,標準品");
  assert.equal(restored.worksheets[0].getCell("B2").value, "確認\n未完了");
  const require = createRequire(import.meta.url), excelRequire = createRequire(require.resolve("exceljs"));
  const archiveRequire = createRequire(excelRequire.resolve("archiver"));
  const archiveUtils = archiveRequire("archiver-utils") as { file: { expand(options: { cwd: string }, pattern: string): string[] } };
  assert.ok(archiveUtils.file.expand({ cwd: path.resolve("public/examples") }, "*.xlsx").includes("audit-business-controls.xlsx"));
});
