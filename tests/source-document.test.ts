import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSourceDocument, checkWorkbookArchive } from "../lib/source-document-parser";
import { documentWorkSource, documentWorkName, matchingSourceUnits, validateDocumentItems } from "../lib/source-document";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { buildWorkflowReviewFromGraph } from "../lib/graph";
import { resolveWorkflowReviewLocally } from "../lib/ai/provider";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentInput, SourceUnits } from "../components/DocumentInput";

test("audit workbook retains merged business identities, blanks, site differences and future-only findings", async()=>{
  const doc=await parseSourceDocument("audit.xlsx",readFileSync("public/examples/audit-business-controls.xlsx"));
  assert.equal(doc.format,"xlsx");
  const second=doc.units.find(unit=>unit.sheet==="業務フロー一覧"&&unit.row===6)!;
  assert.equal(second.cells?.find(c=>c.address==="A6")?.text,"B151");
  assert.equal(second.cells?.find(c=>c.address==="A6")?.sourceAddress,"A5");
  const emptyActor=doc.units.find(unit=>unit.sheet==="業務フロー一覧"&&unit.row===8)!;
  assert.equal(emptyActor.cells?.find(c=>c.address==="D8")?.text,"");
  assert.match(emptyActor.text,/D8=\[空欄\]/);
  assert.match(doc.units.find(unit=>unit.sheet==="工場別補足"&&unit.row===7)!.text,/将来案.*現在.*CSV/);
  assert.match(doc.units.find(unit=>unit.sheet==="監査指摘"&&unit.row===7)!.text,/未定.*現在の作業を置き換えない/);
  assert.ok(doc.warnings.some(text=>text.includes("矢印")));
});

test("text PDF retains three business pages and their hold, handoff and unknown notes",async()=>{
  const doc=await parseSourceDocument("audit.pdf",readFileSync("public/examples/manufacturing-audit.pdf"));
  assert.equal(doc.units.length,3);
  assert.deepEqual(doc.units.map(u=>u.page),[1,2,3]);
  assert.match(doc.units[0].text,/B155/);
  assert.match(doc.units[1].text,/停止基準の数値.*未確認/);
  assert.match(doc.units[2].text,/受け取りの記録は保留の解除を意味しない/);
});

test("unsupported, malformed and excessively expanded archives fail without a partial document",async()=>{
  await assert.rejects(()=>parseSourceDocument("macro.xlsm",Buffer.from("data")),/\.xlsx/);
  await assert.rejects(()=>parseSourceDocument("broken.xlsx",Buffer.from("broken")),/Excel/);
  await assert.rejects(()=>parseSourceDocument("broken.pdf",Buffer.from("broken")),/PDF/);
  const bomb=Buffer.alloc(68);bomb.writeUInt32LE(0x02014b50,0);bomb.writeUInt32LE(0xffffffff,24);bomb.writeUInt32LE(0x06054b50,46);bomb.writeUInt16LE(1,56);bomb.writeUInt32LE(0,62);
  assert.throws(()=>checkWorkbookArchive(bomb),/展開後/);
});

test("AI selects actual evidence units; unrelated jobs are excluded while headers and audit findings remain",async()=>{
  const doc=await parseSourceDocument("audit.xlsx",readFileSync("public/examples/audit-business-controls.xlsx"));
  const selected=validateDocumentItems(doc,[{title:"材料収支",scope:"current",site:"東工場",unitIds:["sheet-1-row-5","sheet-1-row-6"],contextUnitIds:["sheet-1-row-4","sheet-2-row-4","sheet-3-row-7"],note:"将来案は現行から除く"}])[0];
  const text=documentWorkSource(doc,selected);
  assert.equal(documentWorkName(selected),"東工場：材料収支");
  assert.match(text,/業務フロー一覧!A4:L4/);assert.match(text,/将来案/);assert.doesNotMatch(text,/通常と異なる製造操作を報告する/);
  assert.ok(!text.includes(selected.note),"AIの概要を元資料の記述として再入力しない");
  assert.throws(()=>validateDocumentItems(doc,[{...selected,unitIds:["invented-page"]}]),/元資料にない/);
  const [guessedSite]=validateDocumentItems(doc,[{...selected,site:"製造ライン（B155）"}]);
  assert.equal(guessedSite.site,""); assert.match(guessedSite.note,/工場の区分には使っていません/);
  const [unrelatedSite]=validateDocumentItems(doc,[{...selected,unitIds:["sheet-1-row-13"],contextUnitIds:["sheet-1-row-4"]}]);
  assert.equal(unrelatedSite.site,"");
});

test("original bytes and provenance survive SQLite save/reload and local normalization, scoped to their project",async()=>{
  const bytes=readFileSync("public/examples/audit-business-controls.xlsx"), document=await parseSourceDocument("audit.xlsx",bytes);
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),"lens-documents-")),"test.sqlite"));
  const evidence=[{documentId:document.id,documentName:document.name,sha256:document.sha256,itemId:"work-1",unitIds:["sheet-1-row-5"]}];
  const review={summary:"収支",trigger:null,outcome:null,steps:[],transitions:[],dataFlows:[],questions:[],warnings:[],documentEvidence:evidence};
  const graph={workflows:[{id:"flow",name:"収支",reviewContext:review}],nodes:[],edges:[],dataFlows:[]};
  await repo.saveProject({projectId:"p",projectName:"P",graph,transcripts:{},updatedAt:new Date().toISOString()});
  await repo.saveSourceDocument("p",document,bytes);
  assert.deepEqual(Buffer.from((await repo.getSourceDocument("p",document.id))!.bytes),bytes);
  assert.equal(await repo.getSourceDocument("other",document.id),null);
  assert.equal((await repo.listSourceDocuments("p"))[0].id,document.id);
  const loaded=(await repo.loadProject("p"))!;
  assert.deepEqual(buildWorkflowReviewFromGraph(loaded.graph,"flow").documentEvidence,evidence);
  assert.deepEqual(resolveWorkflowReviewLocally({review,workflow:graph.workflows[0],graph}).review.documentEvidence,evidence);
});

test("the document entry leads with the file action, scope and example actions before the source library",()=>{
  const html=renderToStaticMarkup(React.createElement(DocumentInput,{projectId:"p",busy:false,onClose:()=>{},onStart:()=>{},completed:new Set<string>()}));
  assert.match(html,/Excel・PDFを選ぶ/);assert.match(html,/文字を選択できるPDF/);assert.match(html,/監査Excelの例を読み込む/);
  assert.ok(html.indexOf("Excel・PDFを選ぶ")<html.indexOf("監査Excelの例"));
});

test("the selected step opens its literal source row, while horizontal merged titles display once",async()=>{
  const doc=await parseSourceDocument("audit.xlsx",readFileSync("public/examples/audit-business-controls.xlsx"));
  const ids=doc.units.map(unit=>unit.id);
  assert.deepEqual(matchingSourceUnits(doc,ids,"収支の差を確認する").map(unit=>unit.id),["sheet-1-row-6"]);
  assert.deepEqual(matchingSourceUnits(doc,ids,"MES"),[]);
  assert.deepEqual(matchingSourceUnits(doc,ids,"原文にない判断や担当"),[]);
  const html=renderToStaticMarkup(React.createElement(SourceUnits,{document:doc,unitIds:["sheet-1-row-3"]}));
  assert.equal((html.match(/対象：製造課/g)??[]).length,1);
  assert.match(html,/A3:F3/);
});
