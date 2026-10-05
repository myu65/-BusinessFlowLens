import { buildExtractionContext } from './ai/context';
import { type ExtractionReview, type ExtractionTransition, type LensGraph, type Workflow } from './graph';
import { changeReviewConnection } from './review-connection-edits';
import { workflowMergeProblem } from './workflow-merge';

export const dialogueActions = ['ask','refine','connect','disconnect','restore_connection','insert','exclude_step','restore_step','handoff','remove_handoff','incoming_handoff','remove_incoming_handoff','rename_workflow','set_scenario','merge_workflows','merge_assets','rename_asset','save','undo','show','new_story','accept','cancel'] as const;
export type DialogueAction = typeof dialogueActions[number];
export type DialoguePlan = {
  action: DialogueAction; message: string; question: string|null;
  workflowId: string|null; sourceId: string|null; targetId: string|null; otherWorkflowId: string|null;
  condition: string|null; value: string|null; data: string[];
  matches: Array<{sourceStepKey:string;targetStepKey:string|null;keep:'source'|'target'|null}>;
};
export type DialogueTurn = {id:string;createdAt:string;role:'user'|'assistant';text:string;state?:'question'|'proposed'|'applied'|'cancelled';plan?:DialoguePlan};
export type DialogueSession = {turns:DialogueTurn[];plan:DialoguePlan|null;evidence?:string;preview?:import('./review-workbench').InputDraft};
const trim=(text:string)=>text.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export const emptyDialoguePlan=(message:string,question:string|null=null):DialoguePlan=>({action:'ask',message,question,workflowId:null,sourceId:null,targetId:null,otherWorkflowId:null,condition:null,value:null,data:[],matches:[]});

/** Undoing a visible, unaccepted proposal cancels that proposal, never an older saved change. */
export function pendingDialoguePlan(plan:DialoguePlan,pending:DialoguePlan|null|undefined):DialoguePlan{
  return pending&&pending.action!=='ask'&&plan.action==='undo'
    ?{...emptyDialoguePlan('表示していた変更案を取り消します。変更前の図と話は残ります。'),action:'cancel'}
    :plan;
}

/** Retrieval offers identities and their scope; it never decides that two things are the same. */
export function buildDialogueContext(graph:LensGraph,workflow:Workflow,review:ExtractionReview,utterance:string,selectedStepKey?:string){
  const extracted=buildExtractionContext(graph,workflow,utterance);
  const mentioned=graph.workflows.filter(w=>w.id!==workflow.id&&trim(w.name).length>1&&trim(utterance).includes(trim(w.name)));
  const ids=[...new Set([...mentioned.map(w=>w.id),...extracted.workflows.map(w=>w.id)])].slice(0,16);
  const scope=(w:Workflow)=>({id:w.id,name:w.name,scenario:w.scenario??'current',site:w.landscape?.site??w.scenarioLabel??'',effectiveFrom:w.effectiveFrom,effectiveTo:w.effectiveTo});
  const assets=(kind:'system'|'data')=>extracted[kind==='system'?'systems':'data'].map(asset=>{
    const node=graph.nodes.find(n=>n.canonicalKey===asset.canonicalKey&&n.kind===kind)!;
    return {...asset,id:node.id,profile:kind==='system'?graph.knowledge?.systems.find(p=>p.systemId===node.id):undefined};
  });
  return {
    scope:{...extracted.scope,totalCompanyWorkflows:graph.workflows.length,candidateWorkflows:ids.length},
    current:{...scope(workflow),selectedStepKey,steps:review.steps.slice(0,60).map(s=>({id:s.stepKey,name:s.name,actor:s.actor,systems:s.systems.map(t=>t.name),data:s.data.map(d=>({name:d.name,operation:d.operation})),result:s.meaning?.result})),
      omittedSteps:Math.max(0,review.steps.length-60),transitions:review.transitions.slice(0,100),excludedSteps:(review.excludedSteps??[]).slice(0,30).map(s=>({id:s.stepKey,name:s.name})),excludedTransitions:(review.excludedTransitions??[]).slice(0,40),handoffs:review.handoffs?.slice(0,30),incomingHandoffs:review.incomingHandoffs?.slice(0,30),excludedHandoffs:review.excludedHandoffs?.slice(0,30),excludedIncomingHandoffs:review.excludedIncomingHandoffs?.slice(0,30)},
    workflows:ids.map(id=>{const w=graph.workflows.find(w=>w.id===id)!;return {...scope(w),summary:(w.summary??w.description??'').slice(0,250),steps:graph.nodes.filter(n=>n.kind==='process'&&n.workflowId===id).sort((a,b)=>(a.stepOrder??0)-(b.stepOrder??0)).slice(0,12).map(n=>({id:n.canonicalKey.split(':').at(-1),name:n.label,actor:n.actor,result:n.meaning?.result}))};}),
    systems:assets('system'),data:assets('data'),
  };
}

const resolveConnection=(review:ExtractionReview,plan:DialoguePlan,excluded=false)=>{
  const candidates=(excluded?review.excludedTransitions??[]:review.transitions).filter(e=>e.fromStepKey===plan.sourceId&&e.toStepKey===plan.targetId&&(plan.condition===null||e.condition===plan.condition));
  if(candidates.length!==1)throw new Error(candidates.length?'同じ二つの手順に複数の矢印があります。どの条件の矢印を直しますか？':'対象の矢印が見つかりません。どの手順からどの手順へつなぎますか？');
  return candidates[0];
};

/** Recheck every AI target against the current graph before offering or applying a change. */
export function validateDialoguePlan(plan:DialoguePlan,graph:LensGraph,workflow:Workflow,review:ExtractionReview):DialoguePlan{
  if(!plan||!dialogueActions.includes(plan.action)||typeof plan.message!=='string'||!Array.isArray(plan.data)||!Array.isArray(plan.matches))throw new Error('対話の操作案を読み取れませんでした。入力した言葉は残っています。');
  if(plan.action==='ask')return plan;
  const currentActions:DialogueAction[]=['refine','connect','disconnect','restore_connection','insert','exclude_step','restore_step','handoff','remove_handoff','incoming_handoff','remove_incoming_handoff','rename_workflow','set_scenario','save'];
  if(currentActions.includes(plan.action)&&plan.workflowId!==workflow.id)throw new Error('いま開いている業務を操作します。別の業務を開いてから変更してください。');
  const step=(id:string|null,excluded=false)=>{const found=(excluded?review.excludedSteps??[]:review.steps).find(s=>s.stepKey===id);if(!found)throw new Error('対象の手順を特定できません。手順の名前を教えてください。');return found;};
  if(['connect','disconnect','restore_connection','insert'].includes(plan.action)){
    step(plan.sourceId);if(plan.targetId)step(plan.targetId);
    if(plan.action==='connect'&&!plan.targetId)throw new Error('どの手順へつなぐか教えてください。');
    if(plan.action==='disconnect')resolveConnection(review,plan);
    if(plan.action==='restore_connection')resolveConnection(review,plan,true);
    if(plan.action==='insert'&&plan.targetId)resolveConnection(review,plan);
    if(plan.action==='insert'&&!plan.targetId&&review.transitions.some(e=>e.fromStepKey===plan.sourceId))throw new Error('どの矢印の間へ追加しますか？ 次の手順の名前を教えてください。');
  }
  if(plan.action==='exclude_step')step(plan.sourceId);
  if(plan.action==='restore_step')step(plan.sourceId,true);
  if(['handoff','remove_handoff','incoming_handoff','remove_incoming_handoff'].includes(plan.action)){
    step(plan.sourceId);const other=graph.workflows.find(w=>w.id===plan.otherWorkflowId);
    if(!other||other.id===workflow.id)throw new Error('受け渡す先の業務を特定できません。業務名を教えてください。');
    if((other.scenario??'current')!==(workflow.scenario??'current'))throw new Error('現行と将来案の仕事は同じ流れとして接続できません。どちらの状態を確認しますか？');
    if(plan.targetId&&!graph.nodes.some(n=>n.kind==='process'&&n.workflowId===other.id&&n.canonicalKey.split(':').at(-1)===plan.targetId))throw new Error('受渡し先の手順を特定できません。');
    if(plan.action==='remove_handoff'&&(review.handoffs??[]).filter(h=>h.fromStepKey===plan.sourceId&&h.targetWorkflowId===plan.otherWorkflowId&&(!plan.targetId||h.targetStepKey===plan.targetId)).length!==1)throw new Error('外す受渡しを一つに特定できません。相手の手順を教えてください。');
    if(plan.action==='remove_incoming_handoff'&&(review.incomingHandoffs??[]).filter(h=>h.toStepKey===plan.sourceId&&h.sourceWorkflowId===plan.otherWorkflowId&&(!plan.targetId||h.sourceStepKey===plan.targetId)).length!==1)throw new Error('外す受取り元を一つに特定できません。相手の手順を教えてください。');
  }
  if(plan.action==='merge_workflows'){
    const problem=workflowMergeProblem(graph.workflows.find(w=>w.id===plan.sourceId),graph.workflows.find(w=>w.id===plan.targetId));if(problem)throw new Error(problem);
  }
  if(plan.action==='merge_assets'||plan.action==='rename_asset'){
    const source=graph.nodes.find(n=>n.id===plan.sourceId),target=graph.nodes.find(n=>n.id===plan.targetId);
    if(!source||source.kind==='process')throw new Error('対象のシステムまたは情報を特定できません。');
    if(plan.action==='merge_assets'&&(!target||target.kind!==source.kind||target.id===source.id))throw new Error('同じ種類の異なるシステムまたは情報を選んでください。');
  }
  if(['rename_workflow','rename_asset'].includes(plan.action)&&(!plan.value?.trim()||plan.value.length>120))throw new Error('新しい名前を120文字以内で教えてください。');
  if(plan.action==='set_scenario'&&!['current','future','alternative'].includes(plan.value??''))throw new Error('現行・将来案・別案のどれへ変更しますか？');
  if(plan.action==='show'&&!['flow','information','systems','history','company','workflow','dataflow','assets','overview'].includes(plan.value??''))throw new Error('業務の流れ・情報・システム・履歴・会社の全体像のどれを見ますか？');
  if(plan.action==='show'&&plan.workflowId&&plan.workflowId!==workflow.id&&!graph.workflows.some(w=>w.id===plan.workflowId))throw new Error('開く業務を特定できません。業務名を教えてください。');
  if(plan.action==='show'&&plan.sourceId&&!review.steps.some(s=>s.stepKey===plan.sourceId)&&!graph.nodes.some(n=>n.id===plan.sourceId))throw new Error('開く手順やシステム・情報を特定できません。名前を教えてください。');
  if(plan.action==='refine'&&plan.sourceId)step(plan.sourceId);
  return {...plan,message:describeDialoguePlan(plan,graph,workflow,review)};
}

/** Labels are derived from the validated identities, not from an AI's explanation. */
export function describeDialoguePlan(plan:DialoguePlan,graph:LensGraph,workflow:Workflow,review:ExtractionReview){
  const step=(id:string|null)=>[...review.steps,...review.excludedSteps??[]].find(s=>s.stepKey===id)?.name??'対象の手順';
  const asset=(id:string|null)=>graph.nodes.find(n=>n.id===id)?.label??'対象のシステム・情報';
  const work=(id:string|null)=>graph.workflows.find(w=>w.id===id)?.name??workflow.name;
  const arrow=`「${step(plan.sourceId)}」から「${step(plan.targetId)}」への${plan.condition?`「${plan.condition}」の`:''}矢印`;
  switch(plan.action){
    case 'connect':return `${arrow}を追加します。${plan.value==='response'?'例外対応・戻りの流れです。':plan.value==='resume'?'停止した仕事の再開先です。':plan.value==='unknown'?'接続は未確認として残します。':''}`;
    case 'disconnect':return `${arrow}を外します。両方の手順は残します。`;
    case 'restore_connection':return `${arrow}を元に戻します。`;
    case 'exclude_step':return `「${step(plan.sourceId)}」を図から外し、原文と履歴に残します。前後をつなぐ矢印は追加しません。`;
    case 'restore_step':return `「${step(plan.sourceId)}」を図へ戻します。前後の矢印は別に確認できます。`;
    case 'insert':return `「${step(plan.sourceId)}」の後${plan.targetId?`、${step(plan.targetId)}との間`:''}へ、話した作業を追加します。`;
    case 'handoff':return `「${step(plan.sourceId)}」から「${work(plan.otherWorkflowId)}」へ${plan.data.length?`、${plan.data.join('・')}を`:''}受け渡すつながりを追加します。`;
    case 'remove_handoff':return `「${step(plan.sourceId)}」から「${work(plan.otherWorkflowId)}」への受渡しを外します。`;
    case 'incoming_handoff':return `「${work(plan.otherWorkflowId)}」から「${step(plan.sourceId)}」へ${plan.data.length?`、${plan.data.join('・')}を`:''}受け取るつながりを追加します。`;
    case 'remove_incoming_handoff':return `「${work(plan.otherWorkflowId)}」から「${step(plan.sourceId)}」への受渡しを外します。`;
    case 'rename_workflow':return `「${workflow.name}」を「${plan.value}」という名前に変えます。`;
    case 'set_scenario':return `「${workflow.name}」の表示する状態を${plan.value==='current'?'現行':plan.value==='future'?'将来案':'別案'}へ変えます。`;
    case 'merge_workflows':return `「${work(plan.sourceId)}」を「${work(plan.targetId)}」へまとめます。両方の元の話と、変更前の内容を残します。`;
    case 'merge_assets':return `「${asset(plan.sourceId)}」を「${asset(plan.targetId)}」と同じものとしてまとめます。以前の名前を別名と履歴に残します。`;
    case 'rename_asset':return `「${asset(plan.sourceId)}」の名前を「${plan.value}」へ変え、以前の名前を別名として残します。`;
    case 'refine':return `${plan.sourceId?`「${step(plan.sourceId)}」`:'いまの仕事の流れ'}を、話した内容で補足・訂正します。元の話と人の訂正を保持します。`;
    default:return plan.message;
  }
}

export function dialogueConnection(review:ExtractionReview,plan:DialoguePlan):ExtractionTransition|undefined{
  return ['disconnect','restore_connection','insert'].includes(plan.action)&&plan.targetId?resolveConnection(review,plan,plan.action==='restore_connection'):undefined;
}

/** Draft edits retain originals, exclusions and human provenance. They never save by themselves. */
export function applyDialogueReviewOperation(review:ExtractionReview,plan:DialoguePlan,evidence:string):ExtractionReview{
  if(plan.action==='connect')return changeReviewConnection(review,null,{fromStepKey:plan.sourceId!,toStepKey:plan.targetId!,condition:plan.condition,evidence,certainty:plan.value==='unknown'?'unknown':'confirmed',...(['response','resume'].includes(plan.value??'')?{holdEffect:plan.value as 'response'|'resume'}:{})});
  if(plan.action==='disconnect')return changeReviewConnection(review,resolveConnection(review,plan),null);
  if(plan.action==='restore_connection')return changeReviewConnection(review,null,{...resolveConnection(review,plan,true),evidence});
  if(plan.action==='exclude_step'){
    const chosen=review.steps.find(s=>s.stepKey===plan.sourceId)!;
    let next=review;for(const edge of review.transitions.filter(e=>e.fromStepKey===plan.sourceId||e.toStepKey===plan.sourceId))next=changeReviewConnection(next,edge,null);
    next={...next,excludedHandoffs:[...(next.excludedHandoffs??[]),...(next.handoffs??[]).filter(h=>h.fromStepKey===plan.sourceId).map(h=>({...h,excludedBy:evidence}))],excludedIncomingHandoffs:[...(next.excludedIncomingHandoffs??[]),...(next.incomingHandoffs??[]).filter(h=>h.toStepKey===plan.sourceId).map(h=>({...h,excludedBy:evidence}))]};
    return {...next,excludedSteps:[...(next.excludedSteps??[]),{...chosen,humanEdits:[...(chosen.humanEdits??[]),{field:'excluded',before:false,after:true,evidence}]}],steps:next.steps.filter(s=>s!==chosen).map((s,i)=>({...s,order:i+1})),handoffs:next.handoffs?.filter(h=>h.fromStepKey!==plan.sourceId),incomingHandoffs:next.incomingHandoffs?.filter(h=>h.toStepKey!==plan.sourceId),dataFlows:next.dataFlows.filter(f=>!f.relatedStepKeys.length||f.relatedStepKeys.some(k=>k!==plan.sourceId)).map(f=>({...f,relatedStepKeys:f.relatedStepKeys.filter(k=>k!==plan.sourceId)})),questions:[...next.questions,{question:`除外した「${chosen.name}」の前後は、どう接続しますか？`,reason:'手順を飛ばす接続は未確認',target:'handoff'}]};
  }
  if(plan.action==='restore_step'){
    const restored=review.excludedSteps!.find(s=>s.stepKey===plan.sourceId)!;
    const position=Math.min(Math.max(restored.order-1,0),review.steps.length);
    const steps=[...review.steps.slice(0,position),{...restored,humanEdits:[...(restored.humanEdits??[]),{field:'excluded',before:true,after:false,evidence}]},...review.steps.slice(position)].map((s,i)=>({...s,order:i+1}));
    return {...review,steps,excludedSteps:review.excludedSteps!.filter(s=>s!==restored)};
  }
  const outgoing=(h:NonNullable<ExtractionReview['handoffs']>[number])=>h.fromStepKey===plan.sourceId&&h.targetWorkflowId===plan.otherWorkflowId&&(!plan.targetId||h.targetStepKey===plan.targetId);
  const incoming=(h:NonNullable<ExtractionReview['incomingHandoffs']>[number])=>h.toStepKey===plan.sourceId&&h.sourceWorkflowId===plan.otherWorkflowId&&(!plan.targetId||h.sourceStepKey===plan.targetId);
  if(plan.action==='handoff')return {...review,excludedHandoffs:review.excludedHandoffs?.filter(h=>!outgoing(h)),handoffs:[...(review.handoffs??[]).filter(h=>!outgoing(h)),{fromStepKey:plan.sourceId!,targetWorkflowId:plan.otherWorkflowId!,...(plan.targetId?{targetStepKey:plan.targetId}:{}),data:plan.data,description:plan.message,evidence,certainty:'confirmed',origin:'human'}]};
  if(plan.action==='remove_handoff')return {...review,handoffs:(review.handoffs??[]).filter(h=>!outgoing(h)),excludedHandoffs:[...(review.excludedHandoffs??[]),(review.handoffs??[]).filter(outgoing).map(h=>({...h,excludedBy:evidence}))].flat()};
  if(plan.action==='incoming_handoff')return {...review,excludedIncomingHandoffs:review.excludedIncomingHandoffs?.filter(h=>!incoming(h)),incomingHandoffs:[...(review.incomingHandoffs??[]).filter(h=>!incoming(h)),{toStepKey:plan.sourceId!,sourceWorkflowId:plan.otherWorkflowId!,...(plan.targetId?{sourceStepKey:plan.targetId}:{}),data:plan.data,description:plan.message,evidence,certainty:'confirmed',origin:'human'}]};
  if(plan.action==='remove_incoming_handoff')return {...review,incomingHandoffs:(review.incomingHandoffs??[]).filter(h=>!incoming(h)),excludedIncomingHandoffs:[...(review.excludedIncomingHandoffs??[]),(review.incomingHandoffs??[]).filter(incoming).map(h=>({...h,excludedBy:evidence}))].flat()};
  throw new Error('この操作は流れの編集ではありません。');
}
