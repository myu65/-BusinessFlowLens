import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import sharp from "sharp";
import { parseSourceDocument, sourceDocumentMetadata } from "../lib/source-document-parser";
import { documentWorkSource, splitVisualSource, validateDocumentFindings, validateDocumentItems, type SourceImage, type SourceDocument } from "../lib/source-document";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { groundStepEvidence, groundVisualRelations } from "../lib/ai/source-grounding";
import { extractGroundedLocal } from "../lib/local-review";
import { preserveRefinements } from "../lib/refinement";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceUnits } from "../components/DocumentInput";

test("PNG, JPEG and WebP preserve a bounded reading image, without inventing literal text",async()=>{
  for(const name of ["vendor-inspection.png","vendor-inspection.jpg","vendor-inspection.webp"]){
    const bytes=readFileSync(`public/examples/${name}`),images:SourceImage[]=[];
    const document=await parseSourceDocument(name,bytes,{onImage:image=>images.push(image)});
    assert.equal(document.units.length,1);assert.equal(document.units[0].text,"");
    assert.equal(document.units[0].image?.mimeType,"image/jpeg");
    assert.equal(images.length,1);assert.equal((await sharp(images[0].bytes).metadata()).format,"jpeg");
    assert.ok(images[0].width<=1800&&images[0].height<=1800);
    assert.equal(document.byteSize,bytes.length);
  }
  await assert.rejects(()=>parseSourceDocument("wrong.png",readFileSync("public/examples/vendor-inspection.jpg")),/形式とファイル名/);
  await assert.rejects(()=>parseSourceDocument("broken.webp",Buffer.from("broken")),/画像/);
});

test("an image-only PDF retains all pages and source images, with no fabricated PDF text",async()=>{
  const bytes=readFileSync("public/examples/scanned-business-diagrams.pdf"),images:SourceImage[]=[];
  const document=await parseSourceDocument("scan.pdf",bytes,{onImage:image=>images.push(image)});
  assert.deepEqual(document.units.map(unit=>unit.page),[1,2,3]);
  assert.ok(document.units.every(unit=>unit.text===""&&unit.image));
  assert.equal(images.length,3);assert.ok(document.warnings.some(text=>text.includes("画像として読むページ：1、2、3")));
  await assert.rejects(()=>parseSourceDocument("scan.pdf",bytes),/読み取れる文字がありません/);
});

test("Word and PowerPoint keep their original metadata when the optional renderer is unavailable",async()=>{
  const before=process.env.BFL_OFFICE_RENDERER;
  process.env.BFL_OFFICE_RENDERER=join(tmpdir(),"business-flow-missing-renderer","soffice");
  try{for(const name of ["audit-work-instruction.docx","audit-business-diagrams.pptx"]){
    const bytes=readFileSync(`public/examples/${name}`),document=await parseSourceDocument(name,bytes,{onImage:()=>assert.fail("renderer unavailable")});
    assert.equal(document.rendering?.status,"unavailable");assert.deepEqual(document.units,[]);
    assert.match(document.rendering?.message??"",/元資料は保存/);
    assert.equal(document.sha256,sourceDocumentMetadata(name,bytes).sha256);
  }}finally{if(before===undefined)delete process.env.BFL_OFFICE_RENDERER;else process.env.BFL_OFFICE_RENDERER=before;}
});

test("Office documents never render linked external content or macro payloads",async()=>{
  const zip=new JSZip();zip.file("word/document.xml","<document/>");
  zip.file("word/_rels/document.xml.rels",'<Relationships><Relationship TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://invalid.test/hidden.png"/></Relationships>');
  await assert.rejects(async()=>parseSourceDocument("linked.docx",await zip.generateAsync({type:"nodebuffer"})),/外部のファイル/);
  zip.file("word/_rels/document.xml.rels",'<r:Relationships xmlns:r="urn:relationships"><r:Relationship TargetMode="&#69;xternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://invalid.test/hidden.png"/></r:Relationships>');
  await assert.rejects(async()=>parseSourceDocument("prefixed-linked.docx",await zip.generateAsync({type:"nodebuffer"})),/外部のファイル/);
  zip.remove("word/_rels/document.xml.rels");zip.file("word/vbaProject.bin",Buffer.from("payload"));
  await assert.rejects(async()=>parseSourceDocument("macro.docx",await zip.generateAsync({type:"nodebuffer"})),/マクロ/);
});

function visualDocument():SourceDocument {
  const doc=sourceDocumentMetadata("diagram.png",readFileSync("public/examples/vendor-inspection.png"));
  doc.rendering={status:"ready"};
  doc.units=[{id:"page-1",location:"ページ1",text:"品質担当が依頼書を作成する。",image:{width:1280,height:720,mimeType:"image/jpeg"},visualReading:{description:"外部検査会社が検査し、成績書をOutlookで返す。東工場の業務。",uncertainties:["業者内の担当・道具・判断基準は見えない。"],method:"ai",provider:"test",model:"test",completedAt:doc.createdAt}},
    {id:"page-2",location:"ページ2",text:"東工場の補足票。Teamsで成績書を返す。"}];
  return doc;
}

test("page reconciliation retains both references and never treats AI image readings or unknowns as literal evidence",()=>{
  const doc=visualDocument();
  doc.findings=validateDocumentFindings(doc,[{kind:"conflict",unitIds:["page-1","page-2","page-1"],description:"OutlookとTeamsの違いは未解決"}]);
  assert.deepEqual(doc.findings[0].unitIds,["page-1","page-2"]);
  assert.throws(()=>validateDocumentFindings(doc,[{kind:"conflict",unitIds:["page-1"],description:"相違"}]),/元資料で確認/);
  assert.throws(()=>validateDocumentFindings(doc,[{kind:"duplicate",unitIds:["page-1","invented"],description:"同一"}]),/元資料で確認/);
  const [item]=validateDocumentItems(doc,[{title:"委託検査",scope:"current",site:"東工場",unitIds:["page-1"],contextUnitIds:[],note:"candidate only"}]);
  assert.match(item.note,/画像の読取りに基づく候補/);
  assert.deepEqual(validateDocumentItems(doc,[item]),[item]);
  assert.equal(validateDocumentItems(doc,[{...item,title:"東工場：委託検査"}])[0].title,"委託検査");
  const source=documentWorkSource(doc,item),parts=splitVisualSource(source);
  assert.match(parts.literal,/品質担当が依頼書を作成する/);
  assert.doesNotMatch(parts.literal,/成績書をOutlook|業者内の担当|OutlookとTeams/);
  assert.ok(parts.interpretations.some(text=>text.includes("業者内の担当")));
  assert.ok(parts.interpretations.some(text=>text.includes("OutlookとTeams")));
  assert.ok(!source.includes("candidate only"));
  const review=extractGroundedLocal("外部検査会社が検査し、成績書をOutlookで返す。");
  const step=review.steps[0];step.evidence="外部検査会社が検査し、成績書をOutlookで返す。";step.certainty="explicit";
  step.meaning={purpose:"",basis:"",result:"成績書を返す",next:"",condition:"",halt:false,certainty:"confirmed",evidence:step.evidence};
  review.transitions=[{fromStepKey:step.stepKey,toStepKey:"next",condition:"",evidence:step.evidence,certainty:"confirmed"}];
  const grounded=groundVisualRelations(groundStepEvidence(review,source),source);
  assert.equal(grounded.steps[0].evidence,step.evidence);assert.equal(grounded.steps[0].certainty,"inferred");
  assert.equal(grounded.steps[0].meaning?.certainty,"inferred");assert.equal(grounded.transitions[0].certainty,"inferred");
  const human=structuredClone(grounded);human.steps[0].actor="委託先の検査担当";
  human.steps[0].humanEdits=[{field:"actor",before:step.actor,after:"委託先の検査担当",evidence:"利用者が委託先に確認して訂正"}];
  const refined=preserveRefinements(grounded,human);
  assert.equal(refined.steps[0].actor,"委託先の検査担当");assert.deepEqual(refined.steps[0].humanEdits,human.steps[0].humanEdits);
  const html=renderToStaticMarkup(React.createElement(SourceUnits,{document:doc,projectId:"p"}));
  assert.match(html,/AIが画像から読んだ内容 · 要確認/);assert.match(html,/image=page-1/);assert.doesNotMatch(html,/Teamsで成績書/);
});

test("withdrawal rejects late results even after resume, while saved work and original/image bytes remain",async()=>{
  const original=readFileSync("public/examples/vendor-inspection.png"),images:SourceImage[]=[];
  const doc=await parseSourceDocument("vendor.png",original,{onImage:image=>images.push(image)});
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),"lens-visual-cancel-")),"test.sqlite"));
  const snapshot={projectId:"p",projectName:"P",graph:{workflows:[{id:"existing",name:"保存済みの業務"}],nodes:[],edges:[],dataFlows:[]},transcripts:{existing:"人が入力した話"},updatedAt:new Date().toISOString()};
  await repo.saveProject(snapshot);await repo.saveSourceDocument("p",doc,original,images);
  const before=await repo.loadProject("p");
  assert.equal(await repo.getSourceImage("other",doc.id,images[0].unitId),null);
  assert.equal(await repo.setSourceDocumentState("other",doc.id,"withdrawn"),null);
  const withdrawn=await repo.setSourceDocumentState("p",doc.id,"withdrawn");
  assert.equal(withdrawn?.lifecycle?.generation,1);
  await assert.rejects(()=>repo.saveSourceDocument("p",{...doc,analysis:{method:"ai",provider:"test",model:"test",completedAt:doc.createdAt}},original),/取り消され/);
  const resumed=(await repo.setSourceDocumentState("p",doc.id,"active"))!;
  assert.equal(resumed.lifecycle?.generation,2);
  await assert.rejects(()=>repo.saveSourceDocument("p",doc,original),/取り消され/);
  await repo.saveSourceDocument("p",resumed,Buffer.from("must not replace original"));
  assert.deepEqual(Buffer.from((await repo.getSourceDocument("p",doc.id))!.bytes),original);
  assert.deepEqual(Buffer.from((await repo.getSourceImage("p",doc.id,images[0].unitId))!.bytes),Buffer.from(images[0].bytes));
  assert.deepEqual(await repo.loadProject("p"),before);
});
