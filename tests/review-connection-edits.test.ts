import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {ExtractionReview,ExtractionTransition,LensGraph,Workflow} from '../lib/graph';
import {buildWorkflowReviewFromGraph} from '../lib/graph';
import {extractGroundedLocal} from '../lib/local-review';
import {changeReviewConnection} from '../lib/review-connection-edits';
import {describeHumanEdit,diffReviews,previewReviewGraph,recordReviewEdits} from '../lib/review-workbench';
import {preserveRefinements} from '../lib/refinement';
import {resolveWorkflowReviewLocally} from '../lib/ai/provider';
import {SqliteBusinessFlowRepository} from '../lib/storage/sqlite';

function fixture():ExtractionReview{
  const base=extractGroundedLocal('分析担当が試料をセットする。'),names=['試料をセットする','波形を確認する','結果を登録する','登録を保留して再調製する'];
  return {...base,extraction:{method:'ai',provider:'qa',completedAt:'2026-10-05'},steps:names.map((name,i)=>({...base.steps[0],stepKey:`s${i+1}`,order:i+1,name,action:name,actor:'分析担当',evidence:`分析担当が${name}。`,meaning:{purpose:'',basis:'',result:name,next:'',condition:'',halt:i===3,certainty:'confirmed',evidence:name}})),transitions:[
    {fromStepKey:'s1',toStepKey:'s2',condition:null,evidence:'セット後に波形を確認する',certainty:'confirmed'},
    {fromStepKey:'s2',toStepKey:'s3',condition:'波形が正常',evidence:'正常なら結果を登録する',certainty:'confirmed'},
    {fromStepKey:'s2',toStepKey:'s4',condition:'波形が乱れた',evidence:'乱れた場合は登録を保留して再調製する',certainty:'confirmed',sourceRefs:[{documentId:'diagram',unitId:'p1'}]},
  ],questions:[],warnings:[]};
}
const back:ExtractionTransition={fromStepKey:'s4',toStepKey:'s1',condition:'再調製後',holdEffect:'response',certainty:'confirmed',evidence:'担当者が元の試料セットへ戻ると確認'};

test('adding a return changes only the connection and retains the held result and source',()=>{
  const original=fixture(),next=changeReviewConnection(original,null,back),diff=diffReviews(original,next);
  assert.equal(original.transitions.length,3);assert.equal(next.transitions.length,4);assert.deepEqual(next.steps,original.steps);
  assert.equal(next.steps[3].meaning!.halt,true);assert.equal(diff.changed.length,0);assert.equal(diff.addedConnections.length,1);
  assert.equal(next.transitions.at(-1)!.holdEffect,'response');assert.equal(next.transitions.at(-1)!.humanEdits![0].evidence,back.evidence);
});

test('a human-confirmed self-loop with retry and success conditions survives SQLite without duplicating the task',async()=>{
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),'bfl-self-loop-')),'qa.sqlite'));
  const before=fixture(), retry:ExtractionTransition={fromStepKey:'s2',toStepKey:'s2',condition:'通信失敗時、3回未満なら30秒後',certainty:'confirmed',evidence:'担当者が再試行の上限と待ち時間を確認'};
  const edited=changeReviewConnection(before,null,retry), workflow:Workflow={id:'retry-flow',name:'検査結果の送信'}, empty:LensGraph={workflows:[],nodes:[],edges:[],dataFlows:[]};
  await repo.saveProject({projectId:'retry',projectName:'繰り返しの検証',graph:previewReviewGraph(empty,workflow,edited),transcripts:{'retry-flow':'元の話'},updatedAt:'saved'});
  const snapshot=(await repo.loadProject('retry'))!, saved=buildWorkflowReviewFromGraph(snapshot.graph,workflow.id);
  assert.equal(saved.steps.length,before.steps.length);
  const restored=saved.transitions.find(edge=>edge.fromStepKey==='s2'&&edge.toStepKey==='s2')!;
  assert.equal(restored.condition,retry.condition);assert.equal(restored.evidence,retry.evidence);
  assert.ok(restored.humanEdits?.length);assert.ok(saved.transitions.some(edge=>edge.fromStepKey==='s2'&&edge.toStepKey==='s3'));
  assert.equal(snapshot.transcripts['retry-flow'],'元の話');
});

test('changing a branch preserves its old evidence, excludes only the old route and can restore it',()=>{
  const before=fixture(),old=before.transitions[2],next=changeReviewConnection(before,old,{...back,fromStepKey:'s2',condition:'再調製が必要'});
  assert.equal(next.transitions.length,3);assert.ok(next.transitions.some(edge=>edge.toStepKey==='s3'));
  assert.equal(next.excludedTransitions![0].evidence,old.evidence);assert.deepEqual(next.excludedTransitions![0].sourceRefs,old.sourceRefs);
  assert.deepEqual(next.transitions.at(-1)!.sourceRefs,old.sourceRefs);
  assert.match(describeHumanEdit(next.transitions.at(-1)!.humanEdits![0]).join(''),/波形を確認する → 登録を保留して再調製する/);
  const removed=changeReviewConnection(next,next.transitions.at(-1)!,null),restored=changeReviewConnection(removed,null,{...old,evidence:'元の図で確認し戻した'});
  assert.ok(restored.transitions.some(edge=>edge.toStepKey==='s4'));assert.ok(!restored.excludedTransitions!.some(edge=>edge.toStepKey==='s4'));
});

test('AI rereading with new keys keeps a human return and does not resurrect an excluded normal shortcut',()=>{
  const before=fixture(),removed=changeReviewConnection(before,before.transitions[1],null),human=changeReviewConnection(removed,null,back);
  const proposed={...fixture(),steps:fixture().steps.map(step=>({...step,stepKey:`new-${step.stepKey}`})),transitions:fixture().transitions.map(edge=>({...edge,fromStepKey:`new-${edge.fromStepKey}`,toStepKey:`new-${edge.toStepKey}`}))};
  const after=preserveRefinements(proposed,human);
  assert.ok(!after.transitions.some(edge=>edge.fromStepKey==='new-s2'&&edge.toStepKey==='new-s3'));
  assert.ok(after.transitions.some(edge=>edge.fromStepKey==='new-s4'&&edge.toStepKey==='new-s1'&&edge.holdEffect==='response'&&edge.humanEdits?.length));
  assert.equal(after.excludedTransitions![0].fromStepKey,'new-s2');assert.match(after.warnings.join(''),/除外を保持/);
});

test('paraphrasing an excluded condition cannot revive its route, while an existing different branch remains',()=>{
  const before=fixture(),other={...before.transitions[1],condition:'別の検査を終えた場合',evidence:'別検査の結果を登録する'};
  const withOther={...before,transitions:[...before.transitions,other]},human=changeReviewConnection(withOther,before.transitions[1],null);
  const proposed={...withOther,transitions:withOther.transitions.map(edge=>edge===before.transitions[1]?{...edge,condition:'正常な場合'}:edge)},after=preserveRefinements(proposed,human);
  assert.ok(!after.transitions.some(edge=>edge.condition==='正常な場合'));assert.ok(after.transitions.some(edge=>edge.condition==='別の検査を終えた場合'));
  assert.match(after.questions.at(-1)!.question,/異なる条件/);
});

test('human connection decisions and exclusions survive normalization, SQLite and another rereading',async()=>{
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),'bfl-connections-')),'qa.sqlite'));
  const before=fixture(),edited=changeReviewConnection(changeReviewConnection(before,before.transitions[1],null),null,back),workflow:Workflow={id:'qa-flow',name:'試料を測定する'};
  const empty:LensGraph={workflows:[],nodes:[],edges:[],dataFlows:[]},resolved=resolveWorkflowReviewLocally({review:edited,workflow,graph:empty});
  assert.equal(resolved.review.excludedTransitions!.length,1);
  const graph=previewReviewGraph(empty,workflow,resolved.review);
  await repo.saveProject({projectId:'qa',projectName:'検証',graph,transcripts:{'qa-flow':'元の話'},updatedAt:'saved'});
  const saved=buildWorkflowReviewFromGraph((await repo.loadProject('qa'))!.graph,'qa-flow');
  assert.equal(saved.excludedTransitions![0].evidence,before.transitions[1].evidence);assert.equal(saved.transitions.find(edge=>edge.fromStepKey==='s4')!.holdEffect,'response');
  assert.ok(!preserveRefinements(before,saved).transitions.some(edge=>edge.toStepKey==='s3'));
});

test('stale or foreign step destinations cannot mutate a review',()=>{
  const before=fixture();assert.throws(()=>changeReviewConnection(before,null,{...back,toStepKey:'another-workflow-step'}),/この業務/);
  assert.throws(()=>changeReviewConnection(before,back,null),/接続が変わりました/);assert.equal(before.transitions.length,3);
});

test('the detailed editor records deleted branches and condition corrections as human decisions',()=>{
  const before=fixture(),after={...before,transitions:[before.transitions[0],{...before.transitions[2],condition:'再調製が必要'}]},recorded=recordReviewEdits(before,after),reread=preserveRefinements(before,recorded);
  assert.equal(recorded.excludedTransitions!.length,2);assert.ok(recorded.transitions[1].humanEdits?.length);
  assert.deepEqual(reread.transitions.map(edge=>edge.condition),[null,'再調製が必要']);
});
