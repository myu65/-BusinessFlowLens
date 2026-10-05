import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildWorkflowReviewFromGraph,type ExtractionReview,type LensGraph} from '../lib/graph';
import {extractGroundedLocal} from '../lib/local-review';
import {previewReviewGraph} from '../lib/review-workbench';
import {commitAssetMutation,undoAssetMutation} from '../lib/asset-merge';
import {reviewQuestion,reviewQuestionId,retainQuestionReviews,summaryFromStructure,withCurrentExplanation,applyConfirmedAssetNames} from '../lib/current-understanding';
import {emptyDialoguePlan,validateDialoguePlan,buildDialogueContext,applyDialogueReviewOperation,cancelDialogueTurns,type DialogueTurn} from '../lib/dialogue-operations';
import {preserveRefinements} from '../lib/refinement';
import {resolveWorkflowReviewLocally} from '../lib/ai/provider';
import {SqliteBusinessFlowRepository} from '../lib/storage/sqlite';
import {mergeValue} from '../lib/workflow-merge';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DialogueOperationPanel} from '../components/DialogueOperationPanel';

test('operation clarification remains visible in the shared panel and cannot be applied as a change',()=>{
  const html=renderToStaticMarkup(createElement(DialogueOperationPanel,{session:{turns:[],plan:emptyDialoguePlan('対象を確認する','どの矢印ですか？')},busy:false,onAccept:async()=>true,onCancel:()=>{},onReply:async()=>true}));
  assert.match(html,/操作のための確認/);
  assert.match(html,/どの矢印ですか？/);
  assert.match(html,/操作案への返答/);
  assert.doesNotMatch(html,/この案を反映する/);
});

test('cancelled clarification stays cancelled after saving history without altering earlier answers',()=>{
  const question=emptyDialoguePlan('統合相手を確認する','どの業務とまとめますか？');
  const turns:DialogueTurn[]=[{id:'earlier',createdAt:'1',role:'assistant',text:'前の質問',state:'question'},
    {id:'answered',createdAt:'2',role:'user',text:'品質担当です。'},
    {id:'latest',createdAt:'3',role:'assistant',text:question.question!,state:'question',plan:question}];
  const restored=JSON.parse(JSON.stringify(cancelDialogueTurns(turns))) as DialogueTurn[];
  assert.equal(restored.at(-1)?.state,'cancelled');
  assert.deepEqual(restored.slice(0,2),turns.slice(0,2));
  assert.equal(turns.at(-1)?.state,'question');
});

const identity={question:'検査結果台帳はLIMSと同じ仕組みですか？',reason:'同一性が分からない',target:'system' as const};
const owner={question:'検査結果台帳の管理部署はどこですか？',reason:'管理部署が分からない',target:'owner' as const};
const review=():ExtractionReview=>{
  const base=extractGroundedLocal('品質担当が検査結果台帳へ外注検査の結果を入力します。');
  return {...base,steps:base.steps.map(step=>({...step,systems:[{name:'検査結果台帳',interaction:'input',evidence:step.evidence}]})),summary:'LIMSへ直接入力せず台帳へ入力する。LIMSと同じかは未確認。',questions:[identity,owner]};
};
const workflow={id:'lab',name:'検査結果を台帳へ入力する'};

test('asset identity updates the current explanation while archiving an obsolete reading, retaining unknown questions and original source',async()=>{
  const before=review(),empty:LensGraph={workflows:[],nodes:[],edges:[],dataFlows:[]};
  let graph=previewReviewGraph(empty,workflow,before);
  graph=previewReviewGraph(graph,{id:'existing',name:'LIMSを使う'},extractGroundedLocal('品質担当がLIMSで成績書を確認する。'));
  const source=graph.nodes.find(n=>n.label==='検査結果台帳')!,target=graph.nodes.find(n=>n.label==='LIMS')!;
  const merged=commitAssetMutation({graph,sourceId:source.id,targetId:target.id,evidence:'同じ仕組みと確認した',acceptTargetProfile:true},{id:'identity',createdAt:'2026-10-05T00:00:00Z',updatedBy:'qa'});
  const current=buildWorkflowReviewFromGraph(merged.graph,workflow.id);
  assert.match(current.summary,/関係する道具はLIMS/);
  assert.doesNotMatch(current.summary,/直接入力せず/);
  assert.ok(current.readingHistory?.some(h=>h.summary===before.summary&&h.evidence==='同じ仕組みと確認した'));
  assert.deepEqual(current.questions,before.questions,'an alias confirmation does not silently resolve questions');
  assert.equal(current.steps[0].evidence,before.steps[0].evidence);
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),'understanding-')),'graph.sqlite'));
  await repo.saveProject({projectId:'qa',projectName:'qa',graph:merged.graph,transcripts:{lab:'原文の台帳の呼び名'},updatedAt:'2026-10-05T00:00:00Z'});
  const loaded=(await repo.loadProject('qa'))!;
  assert.equal(loaded.transcripts.lab,'原文の台帳の呼び名');
  assert.deepEqual(buildWorkflowReviewFromGraph(loaded.graph,'lab').readingHistory,current.readingHistory);
  const restored=undoAssetMutation(loaded.graph,'identity','later');
  assert.equal(restored.workflows.find(w=>w.id==='lab')?.summary,graph.workflows.find(w=>w.id==='lab')?.summary);
  assert.deepEqual(restored.workflows.find(w=>w.id==='lab')?.reviewContext?.questions,before.questions);
  const replied=reviewQuestion(current,reviewQuestionId(owner),'resolved','管理部署は品質保証部と担当者に確認した','later');
  const withReply={...loaded.graph,workflows:loaded.graph.workflows.map(w=>w.id==='lab'?{...w,reviewContext:{...w.reviewContext!,questions:replied.questions,questionReviews:replied.questionReviews}}:w)};
  assert.equal(buildWorkflowReviewFromGraph(undoAssetMutation(withReply,'identity','later'),'lab').questionReviews?.at(-1)?.evidence,'管理部署は品質保証部と担当者に確認した');
  assert.match(buildWorkflowReviewFromGraph(undoAssetMutation(withReply,'identity','later'),'lab').summary,/関係する道具は検査結果台帳/);
  assert.throws(()=>undoAssetMutation({...loaded.graph,workflows:loaded.graph.workflows.map(w=>w.id==='lab'?{...w,summary:'後から別の説明へ訂正'}:w)},'identity','later'),/説明が更新/);
});

test('human resolution addresses one exact question, survives rereading, and keeps broader or paraphrased unknowns',()=>{
  const before=review(),id=reviewQuestionId(identity),reason='台帳とLIMSは同じ仕組みと確認したので、この同一性の質問は解決済みにする';
  const done=reviewQuestion(before,id,'resolved',reason,'2026-10-05T00:00:00Z');
  assert.deepEqual(done.questions,[owner]);
  assert.equal(done.questionReviews?.[0].evidence,reason);
  const broader={...identity,question:'LIMSと台帳は同じ仕組みですか？管理部署はどこですか？'};
  const reread=retainQuestionReviews({...before,questions:[identity,owner,broader]},done);
  assert.deepEqual(reread.questions,[owner,broader]);
  assert.ok(preserveRefinements({...before,questions:[identity,owner]},done).questions.some(q=>q.question===owner.question));
  assert.ok(!preserveRefinements({...before,questions:[identity,owner]},done).questions.some(q=>q.question===identity.question));
  const reopened=reviewQuestion(done,id,'reopened','別工場の仕組みかもしれないので再確認する','2026-10-05T01:00:00Z');
  assert.ok(reopened.questions.some(q=>q.question===identity.question));
  assert.equal(reopened.questionReviews?.length,2);
  assert.ok(retainQuestionReviews({...before},reopened).questions.some(q=>q.question===identity.question));
  assert.throws(()=>reviewQuestion(done,id,'resolved','分かった','later'),/変わっています/);
  assert.throws(()=>reviewQuestion(before,id,'resolved','', 'later'),/言葉/);
});

test('a still-open merged question is not removed because another original had resolved identical wording',()=>{
  const resolved=reviewQuestion(review(),reviewQuestionId(identity),'resolved','東工場で確認した','at');
  const merged={...resolved,questions:[identity,owner]};
  assert.ok(retainQuestionReviews({...review()},merged).questions.some(q=>q.question===identity.question));
});

test('dialogue resolution exposes stable question IDs and cannot claim an unrelated ownership fact',()=>{
  const before=review(),graph=previewReviewGraph({workflows:[],nodes:[],edges:[],dataFlows:[]},workflow,before);
  const context=buildDialogueContext(graph,workflow,before,'LIMSの同一性の確認を解決済みにする');
  assert.equal(context.current.questions[0].id,reviewQuestionId(identity));
  const plan={...emptyDialoguePlan('解決済みにする'),action:'resolve_question' as const,workflowId:workflow.id,sourceId:reviewQuestionId(identity)};
  validateDialoguePlan(plan,graph,workflow,before);
  const result=applyDialogueReviewOperation(before,plan,'同じLIMSであることを品質担当に確認した');
  assert.deepEqual(result.questions,[owner]);
  assert.deepEqual(result.steps,before.steps,'resolving a question does not invent a System use or owner');
  assert.throws(()=>validateDialoguePlan({...plan,sourceId:'question:unknown'},graph,workflow,before),/確認事項/);
  assert.equal(resolveWorkflowReviewLocally({review:result,workflow,graph}).review.questionReviews?.[0].evidence,'同じLIMSであることを品質担当に確認した');
  assert.deepEqual(buildWorkflowReviewFromGraph(previewReviewGraph(graph,workflow,result),workflow.id).questionReviews,result.questionReviews);
});

test('rereading uses human-confirmed canonical names without rewriting literal evidence, decisions or inferred relations',()=>{
  const original=review(),graph=previewReviewGraph({workflows:[],nodes:[],edges:[],dataFlows:[]},workflow,original),source=graph.nodes.find(n=>n.kind==='system')!;
  const named={...graph,nodes:graph.nodes.map(n=>n.id===source.id?{...n,label:'LIMS',aliases:['検査結果台帳'],humanEdits:[{field:'identity',before:'台帳',after:'LIMS',evidence:'品質担当が同じLIMSと確認した'}]}:n)};
  const fixed=applyConfirmedAssetNames(original,named);
  assert.equal(fixed.steps[0].systems[0].name,'LIMS');
  assert.equal(fixed.steps[0].evidence,original.steps[0].evidence);
  assert.equal(fixed.steps[0].systems[0].evidence,original.steps[0].systems[0].evidence);
  assert.equal(fixed.steps[0].certainty,original.steps[0].certainty);
  assert.deepEqual(fixed.steps[0].meaning,original.steps[0].meaning);
  assert.deepEqual(fixed.questions,original.questions);
  assert.match(fixed.summary,/道具はLIMS/);
  assert.ok(fixed.readingHistory?.some(reading=>reading.evidence.includes('同じLIMSと確認した')));
  assert.equal(applyConfirmedAssetNames(original,{...named,nodes:named.nodes.map(n=>({...n,humanEdits:[]}))}).steps[0].systems[0].name,'検査結果台帳','an AI alias suggestion is not a human identity decision');
});

test('changing a known branch to unconfirmed retains the original edge and earlier human history',()=>{
  const original=review(),a=original.steps[0].stepKey,b='hold',before={...original,steps:[...original.steps,{...original.steps[0],stepKey:b,order:2,name:'保留する'}],transitions:[{fromStepKey:a,toStepKey:b,condition:'方法が決まらない場合',certainty:'confirmed' as const,holdEffect:'response' as const,evidence:'以前の読み取り',humanEdits:[{field:'condition',before:null,after:'方法が決まらない場合',evidence:'担当者の以前の回答'}]}]};
  const changed=applyDialogueReviewOperation(before,{...emptyDialoguePlan('接続は未確認'),action:'connect',sourceId:a,targetId:b,condition:'方法が決まらない場合',value:'unknown'},'どこから保留へ進むかは未確認');
  assert.equal(changed.transitions.length,1);
  assert.equal(changed.transitions[0].certainty,'unknown');
  assert.equal(changed.transitions[0].holdEffect,'response');
  assert.equal((changed.transitions[0].humanEdits?.at(-1)?.before as {evidence:string}).evidence,'以前の読み取り');
  assert.equal(changed.transitions[0].humanEdits?.[0].evidence,'担当者の以前の回答');
});

test('updated explanations describe registered tasks without claiming an unconfirmed order, resumption or completion',()=>{
  const before=review(),more={...before,steps:[...before.steps,{...before.steps[0],stepKey:'hold',order:2,name:'課長へ確認する',actor:null,systems:[],meaning:{purpose:'',basis:'',result:'保留する',next:'',condition:'判定できない場合',halt:true,certainty:'unknown' as const,evidence:''}}],transitions:[]};
  const updated=withCurrentExplanation(more,before,'作業を追加','前後はまだ分からない');
  assert.match(summaryFromStructure(updated),/担当が未確認/);
  assert.match(updated.summary,/図の矢印/);
  assert.doesNotMatch(updated.summary,/完了|再開する|次に課長/);
  assert.ok(updated.readingHistory?.some(item=>item.summary===before.summary));
});
