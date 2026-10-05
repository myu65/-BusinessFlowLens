import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractGroundedLocal } from '../lib/local-review';
import { validateAITransitions } from '../lib/review-connections';
import { discardWithheldResultWrites } from '../lib/rework-flow';
import { previewReviewGraph } from '../lib/review-workbench';
import { buildWorkflowReviewFromGraph, type ExtractionReview, type LensGraph } from '../lib/graph';
import { WorkflowReading } from '../components/WorkflowReading';

function reviewOf(actions: string[]): ExtractionReview {
  const review=extractGroundedLocal(actions.join('\n'));
  review.steps=actions.map((action,index)=>({...review.steps[0],stepKey:`s${index}`,order:index+1,name:action,action,evidence:action,systems:[],data:[],
    meaning:{purpose:'',basis:'',result:action,next:'',condition:'',halt:false,certainty:'confirmed' as const,evidence:action}}));
  review.transitions=[];return review;
}

test('asking for a release continues a hold; the explicit later release and restart remain distinct',()=>{
  const actions=['与信限度を超えた場合は出荷を保留する。','営業がTeamsで経理へ解除を依頼する。','経理が解除を承認した後、SAPが与信判定を再開する。'];
  const review=reviewOf(actions),source=actions.join('');
  review.steps[0].meaning={...review.steps[0].meaning!,halt:true,condition:'与信限度超過'};
  review.transitions=[{fromStepKey:'s0',toStepKey:'s1',condition:null,evidence:actions[0]+actions[1],certainty:'confirmed'},
    {fromStepKey:'s1',toStepKey:'s2',condition:'解除承認後',evidence:actions[2],certainty:'confirmed'}];
  const result=validateAITransitions(review,source);
  assert.equal(result.transitions[0].holdEffect,'response');
  assert.equal(result.transitions[1].holdEffect,'resume');
  assert.equal(result.steps[0].meaning?.halt,true);
  const unknown='営業がTeamsで解除を依頼するか未定です。';
  const proposal=structuredClone(review);proposal.steps[1].evidence=unknown;proposal.transitions=[{...review.transitions[0],evidence:actions[0]+unknown}];
  assert.equal(validateAITransitions(proposal,actions[0]+unknown).transitions.length,0,'a proposed request is not an actually performed response');
});

test('an explicit re-preparation return reaches the unique earlier sample-setting step while registration stays held',()=>{
  const set='分析担当が試料を分析機器へセットします。',stop='波形が乱れた場合は結果の登録を保留して試料を再調製します。';
  const back='再調製後は試料を機器へセットする手順から再測定します。';
  const review=reviewOf([set,'ピークを確認して溶剤量をLIMSへ登録します。',stop]);
  review.steps[2].meaning={...review.steps[2].meaning!,halt:true,condition:'波形が乱れた場合'};
  review.transitions=[{fromStepKey:'s2',toStepKey:'s0',condition:'再調製後',evidence:back,certainty:'confirmed'}];
  const source=set+review.steps[1].evidence+stop+back,result=validateAITransitions(review,source);
  assert.equal(result.transitions.length,1);assert.equal(result.transitions[0].holdEffect,'response');
  assert.equal(result.steps.length,3,'the validator does not create another measurement task');
  const empty:LensGraph={workflows:[],nodes:[],edges:[],dataFlows:[]},workflow={id:'qa',name:'樹脂の残留溶剤を測る'};
  const graph=previewReviewGraph(empty,workflow,result),restored=buildWorkflowReviewFromGraph(graph,workflow.id);
  assert.equal(restored.transitions[0].holdEffect,'response');
  const stopNode=graph.nodes.find(node=>node.kind==='process'&&node.stepOrder===3)!;
  const html=renderToStaticMarkup(createElement(WorkflowReading,{graph,workflowId:workflow.id,initialStepId:stopNode.id,onDetail:()=>{}}));
  assert.match(html,/停止中の対応/);assert.doesNotMatch(html,/再開 ·/);
  for(const [evidence,target]of [[back,'s1'],['再調製後の戻り先は未確認です。','s0'],['再調製後は試料を機器へセットする手順から再測定しません。','s0']]){
    const draft={...review,transitions:[{...review.transitions[0],evidence,toStepKey:target}]};
    assert.equal(validateAITransitions(draft,set+review.steps[1].evidence+stop+evidence).transitions.length,0,evidence+target);
  }
  const noRetry='再調製後も試料を機器へセットする手順では再確認しません。';
  assert.equal(validateAITransitions({...review,transitions:[{...review.transitions[0],evidence:noRetry}]},set+review.steps[1].evidence+stop+noRetry).transitions.length,0);
});

test('returning to the same confirmation needs one earlier grounded match; an ambiguous or omitted connection remains unknown',()=>{
  const check='別の分析担当が元の計量記録と比べて確認します。',stop='濃度が合わない場合は試料を使わず作り直します。',back='作り直した試料の確認も同じ確認手順へ戻ります。';
  const review=reviewOf([check,'品質課長が使用開始を承認します。',stop]);
  review.steps[2].meaning={...review.steps[2].meaning!,halt:true,condition:'濃度が合わない場合'};
  review.transitions=[{fromStepKey:'s2',toStepKey:'s0',condition:'作り直した試料',evidence:back,certainty:'confirmed'}];
  const source=check+review.steps[1].evidence+stop+back;
  assert.equal(validateAITransitions(review,source).transitions[0]?.holdEffect,'response');
  assert.equal(validateAITransitions({...review,transitions:[]},source).transitions.length,0);
  const ambiguous=structuredClone(review);ambiguous.steps[1].action='品質課長が濃度を確認します。';ambiguous.steps[1].evidence=ambiguous.steps[1].action;
  assert.equal(validateAITransitions(ambiguous,source+ambiguous.steps[1].evidence).transitions.length,0);
});

test('a held registration does not write the result; a stated incident record and later normal registration survive',()=>{
  const normal='分析担当が溶剤量をLIMSへ登録します。',stop='波形が乱れた場合は結果の登録を保留して試料を再調製します。';
  const review=reviewOf([normal,stop]);
  const datum={name:'溶剤量',operation:'update' as const,evidence:normal};
  review.steps[0].data=[datum];review.steps[1].data=[datum];
  const result=discardWithheldResultWrites(review,normal+stop);
  assert.deepEqual(result.steps[0].data,[datum]);assert.deepEqual(result.steps[1].data,[]);assert.ok(result.warnings.some(w=>w.includes('登録を保留する段階')));
  assert.deepEqual(review.steps[1].data,[datum],'the proposal and original input are not mutated');
  const physical=structuredClone(review);physical.steps[1].data=[{name:'試料',operation:'update',evidence:stop},datum];
  assert.deepEqual(discardWithheldResultWrites(physical,normal+stop).steps[1].data,[physical.steps[1].data[0]],'stated sample re-preparation survives while the result write is held');
  const incident='結果の登録を保留して、QMSに異常を記録します。',record=reviewOf([incident]);
  record.steps[0].data=[{name:'異常記録',operation:'create',evidence:'QMSに異常を記録します。'}];
  assert.equal(discardWithheldResultWrites(record,incident).steps[0].data.length,1);
  const future='結果の登録を保留して、波形が正常に戻った後に溶剤量をLIMSへ登録します。',futureReview=reviewOf([future,'溶剤量をLIMSへ登録します。']);
  futureReview.steps[0].data=[{...datum,evidence:'溶剤量をLIMSへ登録します。'}];futureReview.steps[1].data=[...futureReview.steps[0].data];
  const futureResult=discardWithheldResultWrites(futureReview,future);
  assert.equal(futureResult.steps[0].data.length,0,'the later result write is not already done at the holding step');
  assert.equal(futureResult.steps[1].data.length,1,'the separate stated later registration is kept');
  const human=structuredClone(review);human.steps[1].humanEdits=[{field:'data',before:[],after:[datum],evidence:'担当者が別途の記録更新を確認'}];
  assert.deepEqual(discardWithheldResultWrites(human,normal+stop).steps[1].data,[datum]);
});
