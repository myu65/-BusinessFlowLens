import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDialogueContext, validateDialoguePlan, emptyDialoguePlan, pendingDialoguePlan, applyDialogueReviewOperation } from '../lib/dialogue-operations';
import { previewReviewGraph, dialogueUndoSnapshot, type InputDraft } from '../lib/review-workbench';
import { extractGroundedLocal } from '../lib/local-review';
import { buildWorkflowReviewFromGraph, type LensGraph } from '../lib/graph';
import { emptyInputKnowledge } from '../lib/input-knowledge';
import { commitAssetMutation, previewAssetMutation, undoAssetMutation } from '../lib/asset-merge';
import { mergeValue } from '../lib/workflow-merge';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteBusinessFlowRepository} from '../lib/storage/sqlite';
import {preserveRefinements} from '../lib/refinement';
import {dialogueCandidate} from '../lib/dialogue-candidate';

const workflow={id:'check',name:'検査結果を確認する',scenario:'current' as const,landscape:{domains:[],site:'東工場',productId:'',productLabel:'',perspective:'',commonProcessId:'',processRole:'independent' as const,variantNote:'',evidence:'聞いた話',materialHandoffs:[]}};
const fixture=()=>{const review=extractGroundedLocal('分析担当が検査値を確認する。品質課長が合否を承認する。');return {review,graph:previewReviewGraph({workflows:[],nodes:[],edges:[],dataFlows:[]},workflow,review)};};

test('undo requested before accepting a proposal cancels it instead of undoing an older saved merge',()=>{
  const undo={...emptyDialoguePlan('取り消す'),action:'undo' as const};
  const pending={...emptyDialoguePlan('担当を訂正する'),action:'refine' as const,workflowId:workflow.id};
  assert.equal(pendingDialoguePlan(undo,pending).action,'cancel');
  assert.equal(pendingDialoguePlan(undo,null).action,'undo');
  assert.equal(pendingDialoguePlan(undo,emptyDialoguePlan('対象を確認する')).action,'undo');
});

test('dialogue cannot edit missing targets, mix scopes, or silently choose among conditional arrows',()=>{
  const {graph,review}=fixture(),a=review.steps[0].stepKey,b=review.steps[1].stepKey;
  const plan={...emptyDialoguePlan('つなぐ'),action:'connect' as const,workflowId:workflow.id,sourceId:a,targetId:b};
  assert.equal(validateDialoguePlan(plan,graph,workflow,review).targetId,b);
  assert.throws(()=>validateDialoguePlan({...plan,targetId:'not-found'},graph,workflow,review),/手順/);
  assert.throws(()=>validateDialoguePlan({...plan,workflowId:'other'},graph,workflow,review),/いま開いて/);
  const branches={...review,transitions:[{fromStepKey:a,toStepKey:b,condition:'合格',evidence:'合格なら進む'},{fromStepKey:a,toStepKey:b,condition:'再検査済み',evidence:'再検査後に進む'}]};
  assert.throws(()=>validateDialoguePlan({...plan,action:'disconnect'},graph,workflow,branches),/複数/);
  assert.equal(validateDialoguePlan({...plan,action:'disconnect',condition:'合格'},graph,workflow,branches).condition,'合格');
  const future={...workflow,id:'future',scenario:'future' as const};graph.workflows.push(future);
  assert.throws(()=>validateDialoguePlan({...plan,action:'handoff',otherWorkflowId:future.id,targetId:null},graph,workflow,review),/現行と将来/);
  assert.throws(()=>validateDialoguePlan({...plan,action:'merge_workflows',sourceId:workflow.id,targetId:future.id},graph,workflow,review),/現在の仕事/);
});

test('dialogue rework, exclusion and restoration retain human words without creating a bypass',()=>{
  const {graph,review}=fixture(),a=review.steps[0].stepKey,b=review.steps[1].stepKey;
  const plan={...emptyDialoguePlan('戻る'),action:'connect' as const,workflowId:workflow.id,sourceId:b,targetId:a,condition:'訂正した後',value:'response'};
  const connected=applyDialogueReviewOperation(review,plan,'訂正したら最初の検査値の確認へ戻して');
  const back=connected.transitions.find(e=>e.fromStepKey===b)!;
  assert.equal(back.holdEffect,'response');assert.equal(back.humanEdits?.[0].evidence,'訂正したら最初の検査値の確認へ戻して');
  const removed=applyDialogueReviewOperation(connected,{...plan,action:'exclude_step',sourceId:b},'承認は別の業務なので、この図から外して');
  assert.equal(removed.steps.length,1);assert.equal(removed.transitions.length,0);assert.equal(removed.excludedSteps?.[0].evidence,review.steps[1].evidence);
  assert(removed.excludedTransitions?.some(e=>e.fromStepKey===b));
  const restored=applyDialogueReviewOperation(removed,{...plan,action:'restore_step',sourceId:b},'承認を戻して');
  assert.equal(restored.steps.length,2);assert.equal(restored.transitions.length,0);
  const restoredEdge=applyDialogueReviewOperation(restored,{...plan,action:'restore_connection'},'訂正後に確認へ戻る矢印も戻して');
  assert.equal(restoredEdge.transitions.length,1);
  const saved=previewReviewGraph(graph,workflow,restoredEdge);
  assert.equal(buildWorkflowReviewFromGraph(saved,workflow.id).transitions[0].holdEffect,'response');
  const withoutFirst=applyDialogueReviewOperation(review,{...plan,action:'exclude_step',sourceId:a},'最初の確認を一度外す');
  const withFirst=applyDialogueReviewOperation(withoutFirst,{...plan,action:'restore_step',sourceId:a},'最初の確認を元の位置へ戻す');
  assert.equal(withFirst.steps[0].stepKey,a);assert.deepEqual(withFirst.steps.map(s=>s.order),[1,2]);assert.equal(withFirst.transitions.length,0);
});

test('a conversation inserts a fragment while preserving earlier answers, corrections, original text and document evidence',()=>{
  const {review}=fixture(),before=structuredClone(review),source='分析担当が検査値を確認する。品質課長が合否を承認する。',note='確認と承認の間に、品質担当がSharePointへ原本を保存する';
  before.documentEvidence=[{documentId:'original',documentName:'手順.pdf',sha256:'sha',itemId:'item',unitIds:['page-1']}];
  before.steps[0].humanEdits=[{field:'actor',before:'営業担当',after:'分析担当',evidence:'担当者に聞いて訂正'}];
  const answers=[{id:'first',kind:'answer' as const,question:'担当は？',answer:'営業担当'},{id:'correction',kind:'correction' as const,question:'担当は？',answer:'分析担当',supersedes:'first'},{id:'unclear',kind:'deferred' as const,question:'承認後は？',answer:'まだ分からない'}];
  const extracted={review:extractGroundedLocal('品質担当がSharePointへ原本を保存する。'),provider:'qa',followUpAnswers:[]};
  const original=structuredClone({before,answers});
  const candidate=dialogueCandidate({action:'insert',workflow,before,source,evidence:note,answers,placement:{afterStepKey:before.steps[0].stepKey,transition:before.transitions[0]},noteId:'qa-note',extracted});
  assert.deepEqual(candidate.answerHistory,answers);assert.deepEqual(candidate.review.documentEvidence,before.documentEvidence);
  assert.equal(candidate.review.steps.length,3);assert.deepEqual(candidate.review.steps[0].humanEdits,before.steps[0].humanEdits);
  assert.equal(candidate.sourceNotes,source+'\n'+note);assert.equal(candidate.baseline,before);
  const middle=candidate.review.steps[1];assert.equal(middle.actor,'品質担当');assert(middle.systems.some(s=>s.name==='SharePoint'));
  assert(candidate.review.transitions.some(e=>e.fromStepKey===before.steps[0].stepKey&&e.toStepKey===middle.stepKey));
  assert(candidate.review.transitions.some(e=>e.fromStepKey===middle.stepKey&&e.toStepKey===before.steps[1].stepKey));
  assert.deepEqual({before,answers},original);assert.deepEqual(JSON.parse(JSON.stringify(candidate)).answerHistory,answers);
});

test('removed outgoing and incoming handoffs stay excluded after rereading and reload until a person reconnects them',()=>{
  const {graph,review}=fixture(),currentStep=review.steps[0].stepKey;
  const other={...workflow,id:'peer',name:'成績書を送る'};
  const full=previewReviewGraph(graph,other,review),otherStep=review.steps[1].stepKey;
  const plan={...emptyDialoguePlan('成績書を渡す'),workflowId:workflow.id,sourceId:currentStep,targetId:otherStep,otherWorkflowId:other.id,data:['成績書PDF'],action:'handoff' as const};
  validateDialoguePlan(plan,full,workflow,review);
  const outgoing=applyDialogueReviewOperation(review,plan,'確認の仕事から成績書PDFを渡す');
  const connected=applyDialogueReviewOperation(outgoing,{...plan,action:'incoming_handoff'},'成績書PDFを送り元の仕事から受け取る');
  const removed=applyDialogueReviewOperation(applyDialogueReviewOperation(connected,{...plan,action:'remove_handoff'},'送り先が違うので外す'),{...plan,action:'remove_incoming_handoff'},'受取り元も違うので外す');
  const reloaded=buildWorkflowReviewFromGraph(previewReviewGraph(full,workflow,removed),workflow.id);
  assert.equal(reloaded.excludedHandoffs?.[0].excludedBy,'送り先が違うので外す');
  assert.equal(reloaded.excludedIncomingHandoffs?.[0].evidence,'成績書PDFを送り元の仕事から受け取る');
  const reread=preserveRefinements(connected,reloaded);
  assert.equal(reread.handoffs?.length,0);assert.equal(reread.incomingHandoffs?.length,0);
  assert(reread.warnings.some(w=>w.includes('人が外した業務間')));
  const restored=applyDialogueReviewOperation(reread,plan,'同じ成績書を渡すと確認できたので、この接続を戻す');
  assert.equal(restored.handoffs?.length,1);assert.equal(restored.excludedHandoffs?.length,0);assert.equal(restored.excludedIncomingHandoffs?.length,1);
});

test('a 300-workflow conversation keeps a bounded context and offers explicitly mentioned future scope without merging it',()=>{
  const {graph,review}=fixture();for(let i=0;i<300;i++)graph.workflows.push({id:`w${i}`,name:`通常業務${i}`});
  graph.workflows.push({...workflow,id:'future',name:'検査結果の確認の将来案',scenario:'future'});
  const context=buildDialogueContext(graph,workflow,review,'検査結果の確認の将来案と同じか見たい',review.steps[0].stepKey);
  assert(context.workflows.length<=16);assert.equal(context.scope.totalCompanyWorkflows,302);assert(context.workflows.some(w=>w.id==='future'&&w.scenario==='future'));
  assert.equal(context.current.selectedStepKey,review.steps[0].stepKey);assert(context.systems.length<=30&&context.data.length<=30);
});

function assetFixture():LensGraph{
  const {graph}=fixture();graph.knowledge=emptyInputKnowledge();
  graph.nodes.push({id:'old',canonicalKey:'data:old',kind:'data',label:'成績書PDF',description:'成績書PDF',status:'confirmed',sourceRefs:[{documentId:'original',unitId:'page-1'}]},
    {id:'new',canonicalKey:'data:new',kind:'data',label:'成績書',description:'成績書',status:'confirmed'},
    {id:'system',canonicalKey:'system:lims',kind:'system',label:'LIMS',description:'LIMS',status:'confirmed'});
  graph.edges.push({id:'receive',source:graph.nodes[0].id,target:'old',relation:'reads',workflowIds:[workflow.id],evidence:'PDFを読む'});
  graph.knowledge.handoffs=[{id:'handoff',sourceWorkflowId:workflow.id,targetWorkflowId:'peer',dataIds:['old'],dataBindings:[{name:'成績書PDF',dataId:'old',evidence:'購買が対応を確認'}],description:'渡す',kind:'information',evidence:'元の話'}];
  return graph;
}
test('asset merge archives original evidence and bindings, and undo preserves unrelated additions',()=>{
  const graph=assetFixture(),before=structuredClone(graph);
  const result=commitAssetMutation({graph,sourceId:'old',targetId:'new',evidence:'成績書PDFと成績書は同じ資料です'},{id:'merge',createdAt:'2026-10-05',updatedBy:'qa'});
  assert.deepEqual(graph,before);assert(!result.graph.nodes.some(n=>n.id==='old'));assert(result.graph.nodes.find(n=>n.id==='new')?.aliases?.includes('成績書PDF'));
  assert.equal(result.graph.knowledge?.handoffs?.[0].dataBindings?.[0].dataId,'new');
  assert.equal(result.record.changes.nodes.find(c=>c.key==='old')?.before?.sourceRefs?.[0].documentId,'original');
  const extra={...result.graph,nodes:[...result.graph.nodes,{id:'extra',canonicalKey:'data:extra',kind:'data' as const,label:'追加資料',description:'追加資料',status:'unknown' as const}]};
  const restored=undoAssetMutation(extra,'merge','later');
  assert(restored.nodes.some(n=>n.id==='extra'));assert.equal(restored.knowledge?.handoffs?.[0].dataBindings?.[0].dataId,'old');
  assert.equal(mergeValue(restored.nodes.filter(n=>n.id!=='extra').sort((a,b)=>a.id.localeCompare(b.id))),mergeValue(before.nodes.sort((a,b)=>a.id.localeCompare(b.id))));
});

test('asset identity conflicts need an explicit choice and undo cannot overwrite later dependent changes',()=>{
  const graph=assetFixture();graph.nodes.find(n=>n.id==='old')!.description='試験前の暫定結果';graph.nodes.find(n=>n.id==='new')!.description='品質課長が承認した確定結果';
  assert.throws(()=>previewAssetMutation({graph,sourceId:'old',targetId:'new',evidence:'同じにしたい'}),/説明が違い/);
  assert.throws(()=>previewAssetMutation({graph,sourceId:'old',targetId:'system',evidence:'同じにしたい'}),/同じ種類/);
  const merged=commitAssetMutation({graph,sourceId:'old',targetId:'new',evidence:'確定結果の説明を残す',acceptTargetProfile:true},{id:'chosen',createdAt:'now',updatedBy:'qa'});
  merged.graph.edges.push({id:'later',source:'system',target:'new',relation:'writes',workflowIds:[workflow.id]});
  assert.throws(()=>undoAssetMutation(merged.graph,'chosen','later'),/関係する構造/);
});

test('aliasing keeps both relation corrections and does not turn an uncertain use into a confirmed one',()=>{
  const graph=assetFixture(),process=graph.nodes[0].id;
  graph.nodes.find(n=>n.id==='old')!.humanEdits=[{field:'label',before:'試験資料',after:'成績書PDF',evidence:'現場で呼ぶ名前を訂正'}];
  graph.edges=graph.edges.filter(e=>e.id!=='receive');
  graph.edges.push({id:'a',source:process,target:'old',relation:'reads',workflowIds:[workflow.id],status:'confirmed',evidence:'担当がPDFを読む',humanEdits:[{field:'relation',before:'writes',after:'reads',evidence:'閲覧だけと訂正'}]},
    {id:'b',source:process,target:'new',relation:'reads',workflowIds:[workflow.id],status:'unknown',evidence:'成績書を読むかは未確認',humanEdits:[{field:'certainty',before:'confirmed',after:'unknown',evidence:'利用方法は調査中'}]});
  const merged=commitAssetMutation({graph,sourceId:'old',targetId:'new',evidence:'成績書PDFと成績書は同じ資料です'},{id:'alias-evidence',createdAt:'now',updatedBy:'qa'});
  const edge=merged.graph.edges.find(e=>e.source===process&&e.target==='new')!;
  assert.equal(edge.status,'unknown');assert.equal(edge.humanEdits?.length,2);assert(edge.evidence?.includes('担当がPDFを読む')&&edge.evidence.includes('未確認'));
  assert.equal(merged.graph.nodes.find(n=>n.id==='new')?.humanEdits?.length,2);
  const restored=undoAssetMutation(merged.graph,merged.record.id,'later');
  assert.equal(restored.edges.find(e=>e.id==='a')?.status,'confirmed');assert.equal(restored.edges.find(e=>e.id==='b')?.status,'unknown');
});

test('asset rename keeps a stable identity, old name and reversible human provenance',()=>{
  const graph=assetFixture(),renamed=commitAssetMutation({graph,sourceId:'old',name:'外注検査の成績書',evidence:'成績書PDFを外注検査の成績書と呼ぶ'},{id:'rename',createdAt:'now',updatedBy:'qa'});
  assert.deepEqual(renamed.affectedWorkflows,[workflow.id]);
  const node=renamed.graph.nodes.find(n=>n.id==='old')!;
  assert.equal(node.canonicalKey,'data:old');assert(node.aliases?.includes('成績書PDF'));assert.equal(node.humanEdits?.at(-1)?.before,'成績書PDF');
  assert.equal(undoAssetMutation(renamed.graph,'rename','later').nodes.find(n=>n.id==='old')?.label,'成績書PDF');
});

test('dialogue undo snapshot retains the prior workflow and literal source without nesting older snapshots',()=>{
  const {review}=fixture();const draft:InputDraft={workflow,review,sourceNotes:'元の話',answers:{},answerHistory:[],provider:'human',baseline:null};
  const prior=dialogueUndoSnapshot(draft,'元の話'),next=dialogueUndoSnapshot({...draft,workflow:{...workflow,name:'新しい名前'},dialogueUndo:prior},'その後の話');
  assert.equal(next.draft?.workflow.name,'新しい名前');assert(!Object.hasOwn(next.draft!,'dialogueUndo'));assert.equal(prior.draft?.workflow.name,workflow.name);assert.equal(prior.draft?.sourceNotes,'元の話');
});

test('asset merge uses the same transfer identity as SQLite and undo survives persistence',async()=>{
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),'bfl-asset-undo-')),'test.sqlite'));
  const graph=assetFixture();graph.nodes.push({id:'second-system',canonicalKey:'system:second',kind:'system',label:'別名のLIMS',description:'別名のLIMS',status:'confirmed'});
  graph.dataFlows=[{id:'old-transfer',sourceSystemId:'system',targetSystemId:'second-system',dataIds:['old'],workflowIds:[workflow.id],processIds:[graph.nodes[0].id],transferType:'file',direction:'push',automation:'manual',evidence:'元の転送の話',status:'confirmed'}];
  await repo.saveProject({projectId:'test',projectName:'検証',graph,transcripts:{[workflow.id]:'元の業務の話'},updatedAt:'before'});
  const before=(await repo.loadProject('test'))!,source=before.graph.nodes.find(n=>n.label==='別名のLIMS')!,target=before.graph.nodes.find(n=>n.label==='LIMS')!;
  const merged=commitAssetMutation({graph:before.graph,sourceId:source.id,targetId:target.id,evidence:'同じLIMSとして確認した'},{id:'persisted',createdAt:'now',updatedBy:'qa'});
  await repo.saveProject({...before,graph:merged.graph,updatedAt:'merged'});
  const loaded=(await repo.loadProject('test'))!,restored=undoAssetMutation(loaded.graph,'persisted','later');
  await repo.saveProject({...loaded,graph:restored,updatedAt:'undone'});
  const result=(await repo.loadProject('test'))!;
  assert.equal(result.graph.dataFlows[0].id,before.graph.dataFlows[0].id);assert.equal(result.graph.nodes.find(n=>n.id===source.id)?.label,source.label);assert.equal(result.transcripts[workflow.id],'元の業務の話');
});
