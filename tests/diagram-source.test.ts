import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractGroundedLocal } from "../lib/local-review";
import { extractWorkflowReviewWithAI, resolveWorkflowReviewLocally } from "../lib/ai/provider";
import { groundDiagramReferences, workflowSourceImages, markDiagramVariants } from "../lib/ai/document-context";
import { correctionCandidate, correctionPrior } from "../lib/ai/workflow-correction";
import { editReviewStep, previewReviewGraph } from "../lib/review-workbench";
import { preserveRefinements } from "../lib/refinement";
import { buildWorkflowReviewFromGraph, type LensGraph } from "../lib/graph";
import type { SourceDocument, WorkflowSourceImage } from "../lib/source-document";
import { PDF_RENDER_VERSION } from "../lib/source-document";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { WorkflowReading } from "../components/WorkflowReading";
const empty:LensGraph={workflows:[],nodes:[],edges:[],dataFlows:[]};
const workflow={id:"vendor",name:"委託検査を受け入れる"};
const source="購買担当がPDF成績書を受け取る。\n品質担当がLIMSに成績書を登録する。";
const images:WorkflowSourceImage[]=Array.from({length:4},(_,i)=>({documentId:"document",unitId:`page-${i+1}`,location:`ページ${i+1}`,mimeType:"image/jpeg",width:400,height:300,bytes:readFileSync("public/examples/vendor-inspection.jpg")}));

test("image extraction uses every scoped page directly, preserves anchors through saving, and displays the same graph outside input",async()=>{
  const bodies:any[]=[],draft=extractGroundedLocal(source);
  draft.steps.forEach(step=>{step.evidence="図の品質担当から登録への矢印";step.sourceRefs=[{documentId:"document",unitId:"page-4"}];});
  draft.transitions.forEach(edge=>{edge.evidence="受取から登録へ向かう矢印";edge.sourceRefs=[{documentId:"document",unitId:"page-4"}];});
  let transportDraft: typeof draft & { correctionFields?: {stepKey:string;field:string}[] }=draft;
  const server=createServer(async(request,response)=>{
    let text="";for await(const chunk of request)text+=chunk; bodies.push(JSON.parse(text));
    response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(transportDraft)}}]}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address() as {port:number}, config={AI_RUNTIME:"",AI_MODEL:"test-vision",AI_API_KEY:"test-key",AI_BASE_URL:`http://127.0.0.1:${address.port}`,AI_PROTOCOL:"openai"};
  const before=Object.fromEntries(Object.keys(config).map(key=>[key,process.env[key]]));Object.assign(process.env,config);
  try {
    const result=await extractWorkflowReviewWithAI({interview:"資料の図から読む。",workflow,graph:empty,images});
    assert.equal(bodies.length,2);assert.deepEqual(bodies.map(body=>body.messages[1].content.filter((part:any)=>part.type==="image_url").length),[3,1]);
    assert.match(bodies[1].messages[1].content[0].text,/Previous page batch candidate/);
    assert.equal(result.review.extraction?.imagePages,4);
    assert.ok(result.review.steps.every(step=>step.certainty==="inferred"));
    assert.deepEqual(result.review.steps[0].sourceRefs,[{documentId:"document",unitId:"page-4"}]);
    assert.equal(result.review.steps.length,draft.steps.length,"repeated pages do not multiply the candidate's tasks");
    const target=result.review.steps[0];
    transportDraft=structuredClone(result.review);
    transportDraft.steps.forEach(step=>{step.name='無関係な改名';step.action='無関係な書き直し';step.evidence='別の読み取り説明';});
    transportDraft.steps[0].actor='営業事務担当';transportDraft.transitions=[];
    transportDraft.correctionFields=[{stepKey:target.stepKey,field:'actor'}];
    const correction=await extractWorkflowReviewWithAI({interview:'資料の図から読む。',workflow,graph:empty,images,previousReview:result.review,
      correction:{stepKey:target.stepKey,text:'受取担当だけ営業事務担当へ訂正します。'},followUpAnswers:[{question:'受取担当の訂正',answer:'受取担当だけ営業事務担当へ訂正します。'}]});
    assert.equal(correction.review.steps[0].actor,'営業事務担当');
    assert.equal(correction.review.steps[0].name,target.name);assert.equal(correction.review.steps[0].action,target.action);
    assert.deepEqual(JSON.parse(JSON.stringify(correction.review.steps[1])),JSON.parse(JSON.stringify(result.review.steps[1])));
    assert.deepEqual(correction.review.transitions,result.review.transitions);
    assert.ok(correction.review.steps[0].humanEdits?.some(edit=>edit.field==='actor'&&edit.after==='営業事務担当'));
    const resolved=resolveWorkflowReviewLocally({review:result.review,workflow,graph:empty});
    const graph=previewReviewGraph(empty,workflow,resolved.review), repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),"bfl-diagram-")),"test.sqlite"));
    await repo.saveProject({projectId:"qa",projectName:"独立検証",graph,transcripts:{vendor:"資料の図から読む。"},updatedAt:new Date().toISOString()});
    const loaded=(await repo.loadProject("qa"))!.graph, review=buildWorkflowReviewFromGraph(loaded,"vendor");
    assert.deepEqual(review.steps[0].sourceRefs,result.review.steps[0].sourceRefs);
    assert.equal(review.extraction?.imagePages,4);
    const html=renderToStaticMarkup(React.createElement(WorkflowReading,{graph:loaded,workflowId:"vendor",onDetail:()=>{}}));
    assert.match(html,/この仕事のフロー図/);assert.match(html,/input-flow-canvas/);assert.match(html,/PDF成績書を受け取る/);
  }finally{for(const [key,value]of Object.entries(before))value===undefined?delete process.env[key]:process.env[key]=value;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("original evidence cannot cross projects, invent pages, or use a different file hash",async()=>{
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),"bfl-source-")),"test.sqlite"));
  const document:SourceDocument={id:"document",name:"原本.pdf",format:"pdf",sha256:"known-hash",byteSize:3,createdAt:new Date().toISOString(),rendering:{status:"ready",version:PDF_RENDER_VERSION},units:images.map(image=>({id:image.unitId,location:image.location,text:"",image:{width:image.width,height:image.height,mimeType:image.mimeType}})),warnings:[]};
  await repo.saveProject({projectId:"qa",projectName:"QA",graph:empty,transcripts:{},updatedAt:new Date().toISOString()});
  await repo.saveSourceDocument("qa",document,new Uint8Array([1,2,3]),images);
  const evidence={documentId:"document",documentName:"原本.pdf",sha256:"known-hash",itemId:"work",unitIds:["page-1","page-4"]};
  assert.deepEqual((await workflowSourceImages(repo,"qa",[evidence])).map(image=>image.unitId),["page-1","page-4"]);
  await assert.rejects(workflowSourceImages(repo,"other",[evidence]));
  await assert.rejects(workflowSourceImages(repo,"qa",[{...evidence,sha256:"changed-hash"}]));
  await assert.rejects(workflowSourceImages(repo,"qa",[{...evidence,unitIds:["invented-page"]}]));
  const saved=(await repo.getSourceDocument("qa",document.id))!;
  await repo.saveSourceDocument("qa",{...saved.document,rendering:{status:"ready"}},saved.bytes);
  await assert.rejects(workflowSourceImages(repo,"qa",[evidence]),/ページを作り直す必要/);
  const review=extractGroundedLocal(source);review.steps[0].sourceRefs=[{documentId:"other",unitId:"page-1"}];
  const grounded=groundDiagramReferences(review,images);assert.equal(grounded.review.steps[0].sourceRefs,undefined);assert.equal(grounded.interpretation,"");
});

test("a fresh language correction supersedes only its intended field; older human corrections and their original reasons survive",()=>{
  let prior=extractGroundedLocal(source);const step=prior.steps[0];
  prior=editReviewStep(prior,step.stepKey,{actor:"品質担当",department:"品質管理部"});
  const proposal=structuredClone(prior);proposal.steps[0].actor="購買担当";proposal.steps[0].department="購買部";
  const protectedPrior=correctionPrior(prior,proposal,{text:"受け取るのは購買担当です。部署は前の訂正のままです。",stepKey:step.stepKey},[{stepKey:step.stepKey,field:"actor"},{stepKey:step.stepKey,field:"sourceRefs"}])!;
  const result=preserveRefinements(proposal,protectedPrior);
  assert.equal(result.steps[0].actor,"購買担当");assert.equal(result.steps[0].department,"品質管理部");
  assert.ok(result.steps[0].humanEdits?.some(edit=>edit.field==="actor"&&edit.after==="品質担当"));
  assert.ok(result.steps[0].humanEdits?.some(edit=>edit.field==="actor"&&edit.after==="購買担当"&&edit.evidence.includes("受け取る")));
  const reread=preserveRefinements(extractGroundedLocal(source),result);assert.equal(reread.steps[0].actor,"購買担当");assert.equal(reread.steps[0].department,"品質管理部");
});

test("a selected-step correction cannot rename other actions, change connections, or bury the intended field in reread differences",()=>{
  const previous=extractGroundedLocal(source), target=previous.steps[0];
  const proposed=structuredClone(previous);
  proposed.steps.forEach(step=>{step.name='AIが書き直した名前';step.action='無関係な書き直し';step.evidence='別の説明';});
  proposed.steps[0].actor='営業事務担当';proposed.steps[1].actor='勝手に変えた担当';proposed.transitions=[];
  proposed.dataFlows=[{sourceSystem:'Outlook',targetSystem:'LIMS',data:['成績書'],transferType:'manual',direction:'push',automation:'manual',frequency:'都度',evidence:'勝手な書き直し',relatedStepKeys:[target.stepKey],certainty:'inferred'}];
  const correction={text:'受取担当だけ営業事務担当に直す',stepKey:target.stepKey};
  const fields=[{stepKey:target.stepKey,field:'actor'},{stepKey:previous.steps[1].stepKey,field:'actor'}];
  const candidate=correctionCandidate(previous,proposed,correction,fields);
  assert.deepEqual(candidate.steps[0],{...previous.steps[0],actor:'営業事務担当'});
  assert.deepEqual(candidate.steps[1],previous.steps[1]);assert.deepEqual(candidate.transitions,previous.transitions);
  assert.deepEqual(candidate.dataFlows,previous.dataFlows);
  const prior=correctionPrior(previous,candidate,correction,fields)!;
  const result=preserveRefinements(candidate,prior);
  assert.equal(result.steps[0].humanEdits?.filter(edit=>edit.field==='actor').at(-1)?.after,'営業事務担当');
  assert.deepEqual(JSON.parse(JSON.stringify(result.steps[1])),JSON.parse(JSON.stringify(previous.steps[1])));
  const whole=correctionCandidate(previous,proposed,{text:'受取担当を営業事務担当へ直す'},[{stepKey:target.stepKey,field:'actor'}]);
  assert.deepEqual(whole.steps[1],previous.steps[1]);assert.equal(whole.steps[0].name,target.name);
});

test("contradictory page variants stay unresolved, while actual same-page branches and human-confirmed choices remain distinct",()=>{
  const review=extractGroundedLocal("SAPが出荷を保留する。\n営業がTeamsで解除を依頼する。\n営業がOutlookで解除を依頼する。");
  const [hold,teams,mail]=review.steps, refs=images.map(({documentId,unitId})=>({documentId,unitId}));
  review.transitions=[{fromStepKey:hold.stepKey,toStepKey:teams.stepKey,condition:null,evidence:"1ページの矢印",certainty:"inferred",sourceRefs:[refs[0]]},
    {fromStepKey:hold.stepKey,toStepKey:mail.stepKey,condition:null,evidence:"2ページの矢印",certainty:"inferred",sourceRefs:[refs[1]]}];
  const result=markDiagramVariants(review,[[refs[0],refs[1]]]);
  assert.ok(result.transitions.every(edge=>edge.sourceVariant==="document_conflict"&&edge.certainty==="unknown"));
  const graph=previewReviewGraph(empty,workflow,result), loaded=buildWorkflowReviewFromGraph(graph,"vendor");
  assert.ok(loaded.transitions.every(edge=>edge.sourceVariant==="document_conflict"&&edge.certainty==="unknown"));
  const samePage=structuredClone(review);samePage.transitions[1].sourceRefs=[refs[0]];
  assert.ok(markDiagramVariants(samePage,[[refs[0],refs[1]]]).transitions.every(edge=>!edge.sourceVariant));
  const confirmed=structuredClone(review);confirmed.transitions[0].humanEdits=[{field:"certainty",before:"inferred",after:"confirmed",evidence:"現行はTeamsと担当者が確認"}];confirmed.transitions[0].certainty="confirmed";
  assert.equal(markDiagramVariants(confirmed,[[refs[0],refs[1]]]).transitions[0].certainty,"confirmed");
  assert.equal(markDiagramVariants(review,[]).transitions[0].sourceVariant,undefined);
});
