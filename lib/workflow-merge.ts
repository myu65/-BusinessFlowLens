import { canonicalNodeId, getWorkflowProcesses, type CompanyKnowledge, type LensEdge, type LensGraph, type LensNode, type SystemDataFlow, type Workflow } from './graph';
import { emptyInputKnowledge } from './input-knowledge';

export type WorkflowMergeChoice = { sourceProcessId: string; targetProcessId?: string; keep?: 'source' | 'target' };
type Change<T> = { key: string; before: T | null; after: T | null };
type Handoff = NonNullable<CompanyKnowledge['handoffs']>[number];
type MergeChanges = {
  workflows: Change<Workflow>[]; nodes: Change<LensNode>[]; edges: Change<LensEdge>[]; dataFlows: Change<SystemDataFlow>[];
  activities: Change<CompanyKnowledge['activities'][number]>[]; systems: Change<CompanyKnowledge['systems'][number]>[];
  criticalWorkflows: Change<CompanyKnowledge['criticalWorkflows'][number]>[]; handoffs: Change<Handoff>[]; transcripts: Change<string>[];
};
/** Logical identities and a reversible delta, independent of the repository's storage engine. */
export type WorkflowMergeRecord = {
  id: string; sourceWorkflowId: string; targetWorkflowId: string; sourceName: string; targetName: string;
  createdAt: string; updatedBy: string; state: 'merged' | 'undone'; undoneAt?: string;
  choices: WorkflowMergeChoice[]; changes: MergeChanges; targetAfter: string;
};
export type MergeInput = { graph: LensGraph; transcripts: Record<string,string>; sourceId: string; targetId: string; choices: WorkflowMergeChoice[] };
const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g,'');
export function mergeValue(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined && item !== null && !(Array.isArray(item)&&!item.length)).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,ordered(item)])) : v;
  return JSON.stringify(ordered(value)) ?? 'null';
}
const unique = <T,>(items: T[]) => [...new Map(items.map(item => [mergeValue(item),item])).values()];
const ids = (items: string[]) => [...new Set(items)];
const joinEvidence = (a?: string, b?: string) => [a,b].filter((v,i,list) => v && list.indexOf(v) === i).join('\n');
export const workflowMergeSite=(w:Workflow)=>w.landscape?.site??(w.reviewContext?.documentEvidence?.length?w.scenarioLabel??'':'');
/** Resolve a historical workflow identity without rewriting the original evidence. */
export function workflowMergeDestination(graph:LensGraph,id:string){
  const seen=new Set<string>(),history=graph.knowledge?.workflowMerges??[];
  while(!seen.has(id)){seen.add(id);const next=history.find(r=>r.state==='merged'&&r.sourceWorkflowId===id);if(!next)break;id=next.targetWorkflowId;}
  return id;
}

export function workflowMergeProblem(source?: Workflow, target?: Workflow): string | null {
  if (!source || !target || source.id === target.id) return 'まとめる二つの業務を選んでください。';
  if ((source.scenario ?? 'current') !== (target.scenario ?? 'current')) return '現在の仕事と将来案は別に保ちます。同じ状態の業務を選んでください。';
  if (normalize(workflowMergeSite(source)) !== normalize(workflowMergeSite(target))) return '工場・拠点の範囲が違います。同じ範囲の業務を選んでください。';
  if (source.effectiveFrom !== target.effectiveFrom || source.effectiveTo !== target.effectiveTo) return '対象期間が違います。同じ期間の業務を選んでください。';
  if(source.basedOnWorkflowId===target.id||target.basedOnWorkflowId===source.id)return '比較する元の業務と変更案は、別に保ちます。';
  if(source.landscape?.productId&&target.landscape?.productId&&source.landscape.productId!==target.landscape.productId)return '対象製品が違います。同じ範囲の業務を選んでください。';
  return null;
}

export function workflowMergeChoices(graph: LensGraph, sourceId: string, targetId: string): WorkflowMergeChoice[] {
  const source = getWorkflowProcesses(graph,sourceId), target = getWorkflowProcesses(graph,targetId), used = new Set<string>();
  const names=(step:LensNode)=>[step.action||step.label,step.label].map(text=>{
    const prefix=step.actor?`${step.actor}が`:'';return normalize(prefix&&text.startsWith(prefix)?text.slice(prefix.length):text);
  });
  return source.map(step => {
    const matches = target.filter(other => !used.has(other.id) && names(other).some(name=>names(step).includes(name)));
    if (matches.length !== 1) return {sourceProcessId:step.id};
    used.add(matches[0].id);
    return {sourceProcessId:step.id,targetProcessId:matches[0].id,...(!mergeStepDifferences(step,matches[0],graph).length?{keep:'target' as const}:{})};
  });
}
export function mergeStepDifferences(a: LensNode, b: LensNode, graph?: LensGraph): string[] {
  const fields: Array<[keyof LensNode,string]> = [['action','行うこと'],['actor','担当'],['department','部署'],['executionMode','実行方法'],['meaning','判断・結果'],['boundary','社外の範囲'],['executionContext','実行条件'],['technicalDetails','システム内の詳細'],['detailSteps','個別作業']];
  const differences=fields.filter(([key]) => mergeValue(a[key] ?? null) !== mergeValue(b[key] ?? null)).map(([,name]) => name);
  if(graph){
    const assets=(step:LensNode)=>graph.edges.filter(e=>e.relation!=='next'&&(e.source===step.id||e.target===step.id)).map(e=>[e.relation,e.label,e.source===step.id?e.target:e.source]).sort();
    if(mergeValue(assets(a))!==mergeValue(assets(b)))differences.push('使う道具・扱う情報');
  }
  return differences;
}

function delta<T>(before: T[], after: T[], key: (item:T) => string): Change<T>[] {
  const old = new Map(before.map(item => [key(item),item])), next = new Map(after.map(item => [key(item),item]));
  return [...new Set([...old.keys(),...next.keys()])].flatMap(id => {
    const a=old.get(id) ?? null,b=next.get(id) ?? null;
    return mergeValue(a) === mergeValue(b) ? [] : [{key:id,before:a,after:b}];
  });
}
function fragment(graph: LensGraph, workflowId: string, transcripts: Record<string,string>) {
  const processes=new Set(getWorkflowProcesses(graph,workflowId).map(p=>p.id));
  return mergeValue({workflow:graph.workflows.find(w=>w.id===workflowId),nodes:graph.nodes.filter(n=>processes.has(n.id)),
    edges:graph.edges.filter(e=>e.workflowIds.includes(workflowId)||processes.has(e.source)||processes.has(e.target)),
    dataFlows:graph.dataFlows.filter(f=>f.workflowIds.includes(workflowId)||f.processIds.some(id=>processes.has(id))),
    handoffs:graph.knowledge?.handoffs?.filter(h=>h.sourceWorkflowId===workflowId||h.targetWorkflowId===workflowId),source:transcripts[workflowId]});
}

/** A person chooses correspondence; this does not ask AI to invent a combined sequence. */
export function previewWorkflowMerge(input: MergeInput): {graph: LensGraph; transcripts: Record<string,string>; changes: MergeChanges; count: {combined: number; added: number; handoffs: number}} {
  const {graph,transcripts,sourceId,targetId,choices}=input;
  const source=graph.workflows.find(w=>w.id===sourceId),target=graph.workflows.find(w=>w.id===targetId);
  const problem=workflowMergeProblem(source,target);if(problem)throw new Error(problem);
  const sourceSteps=getWorkflowProcesses(graph,sourceId), targetSteps=getWorkflowProcesses(graph,targetId);
  const sourceById=new Map(sourceSteps.map(p=>[p.id,p])),targetById=new Map(targetSteps.map(p=>[p.id,p]));
  if(choices.length!==sourceSteps.length || new Set(choices.map(c=>c.sourceProcessId)).size!==sourceSteps.length)throw new Error('すべての手順の対応を確認してください。');
  const assigned=choices.flatMap(c=>c.targetProcessId?[c.targetProcessId]:[]);
  if(new Set(assigned).size!==assigned.length)throw new Error('同じ手順へ二つ以上をまとめる場合は、一つずつ確認してください。');
  for(const choice of choices)if(!sourceById.has(choice.sourceProcessId)||choice.targetProcessId&&(!targetById.has(choice.targetProcessId)||!['source','target'].includes(choice.keep??'')))throw new Error('手順の対応が変わりました。選び直してください。');
  const mapping=new Map<string,string>(), additions:LensNode[]=[],replacements=new Map<string,LensNode>();
  for(const choice of choices){
    const original=sourceById.get(choice.sourceProcessId)!;
    if(!choice.targetProcessId){
      const canonicalKey=`process:${targetId}:merged-${encodeURIComponent(sourceId)}-${original.canonicalKey.split(':').at(-1)}`;
      const moved={...original,canonicalKey,id:canonicalNodeId(canonicalKey),workflowId:targetId,stepOrder:targetSteps.length+additions.length+1};
      mapping.set(original.id,moved.id);additions.push(moved);continue;
    }
    const existing=targetById.get(choice.targetProcessId)!, selected=choice.keep==='source'?original:existing;
    const humanEdits=unique([...(original.humanEdits??[]),...(existing.humanEdits??[])]);
    for(const field of ['name','action','actor','department','responsiblePerson','executionMode','meaning','executionContext','boundary','technicalDetails','detailSteps'] as const){
      const nodeField=field==='name'?'label':field;
      if(mergeValue(original[nodeField])!==mergeValue(existing[nodeField]))humanEdits.push({field,before:choice.keep==='source'?existing[nodeField]:original[nodeField],after:selected[nodeField],evidence:`「${source!.name}」と「${target!.name}」を同じ手順として確認し、${choice.keep==='source'?'こちら':'統合先'}の内容を採用`});
    }
    const merged={...selected,id:existing.id,canonicalKey:existing.canonicalKey,workflowId:targetId,stepOrder:existing.stepOrder,
      sourceRefs:unique([...(existing.sourceRefs??[]),...(original.sourceRefs??[])]),humanEdits,evidence:joinEvidence(existing.evidence,original.evidence)};
    mapping.set(original.id,existing.id);replacements.set(existing.id,merged);
  }
  const retainedSource=new Set(choices.filter(c=>!c.targetProcessId||c.keep==='source').map(c=>c.sourceProcessId));
  const replacedTarget=new Set(choices.filter(c=>c.keep==='source'&&c.targetProcessId).map(c=>c.targetProcessId!));
  const nodeId=(id:string)=>mapping.get(id)??id;
  const workflowId=(id:string)=>id===sourceId?targetId:id;
  const pairedSource=new Set(choices.filter(c=>c.targetProcessId).map(c=>c.sourceProcessId));
  let differingConnections=0;
  const mappedEdges:LensEdge[]=[];
  for(const edge of graph.edges){
    const fromSource=sourceById.has(edge.source)||sourceById.has(edge.target),fromTarget=targetById.has(edge.source)||targetById.has(edge.target);
    if(edge.relation!=='next'&&fromSource&&!retainedSource.has(sourceById.has(edge.source)?edge.source:edge.target))continue;
    if(edge.relation!=='next'&&fromTarget&&replacedTarget.has(targetById.has(edge.source)?edge.source:edge.target))continue;
    const mappedSource=nodeId(edge.source),mappedTarget=nodeId(edge.target);
    const changed=mappedSource!==edge.source||mappedTarget!==edge.target;
    const alternative=edge.relation==='next'&&pairedSource.has(edge.source)&&pairedSource.has(edge.target)&&
      !graph.edges.some(e=>e.source===mappedSource&&e.target===mappedTarget&&e.relation==='next'&&e.label===edge.label);
    if(alternative)differingConnections++;
    mappedEdges.push({...edge,...(alternative?{sourceVariant:'document_conflict' as const,status:'unknown' as const}:{}),source:mappedSource,target:mappedTarget,workflowIds:ids(edge.workflowIds.map(workflowId)),
      id:changed?`${mappedSource}--${edge.relation}--${mappedTarget}${edge.relation==='next'?`--condition:${encodeURIComponent(edge.label??'')}`:''}`:edge.id});
  }
  const edges:LensEdge[]=[],edgesByMeaning=new Map<string,LensEdge>();
  for(const edge of mappedEdges){
    const key=JSON.stringify([edge.source,edge.target,edge.relation,edge.label??null]),same=edgesByMeaning.get(key);
    if(same){same.workflowIds=ids([...same.workflowIds,...edge.workflowIds]);same.sourceRefs=unique([...(same.sourceRefs??[]),...(edge.sourceRefs??[])]);same.humanEdits=unique([...(same.humanEdits??[]),...(edge.humanEdits??[])]);same.evidence=joinEvidence(same.evidence,edge.evidence);
      if(edge.sourceVariant)same.sourceVariant=edge.sourceVariant;
      if(same.status!==edge.status||same.holdEffect!==edge.holdEffect){same.status='unknown';if(same.holdEffect!==edge.holdEffect)same.holdEffect=undefined;}
    }
    else{const copy={...edge};edges.push(copy);edgesByMeaning.set(key,copy);}
  }
  const dataFlows=graph.dataFlows.flatMap(f=>{
    const dropped=f.processIds.filter(id=>sourceById.has(id)&&!retainedSource.has(id)||replacedTarget.has(id));
    if(f.processIds.length&&dropped.length===f.processIds.length&&f.workflowIds.every(id=>id===sourceId||id===targetId))return [];
    return [{...f,workflowIds:ids(f.workflowIds.map(workflowId)),processIds:ids(f.processIds.filter(id=>!dropped.includes(id)).map(nodeId))}];
  });
  const knowledge=graph.knowledge??emptyInputKnowledge();
  const handoffs=(knowledge.handoffs??[]).map(h=>({...h,sourceWorkflowId:workflowId(h.sourceWorkflowId),targetWorkflowId:workflowId(h.targetWorkflowId),
    reviewedWorkflowId:h.reviewedWorkflowId?workflowId(h.reviewedWorkflowId):undefined,sourceProcessId:h.sourceProcessId?nodeId(h.sourceProcessId):undefined,targetProcessId:h.targetProcessId?nodeId(h.targetProcessId):undefined}));
  const context=target!.reviewContext,other=source!.reviewContext;
  const stepKey=(id:string)=>graph.nodes.find(n=>n.id===id)?.canonicalKey.split(':').at(-1);
  const mappedStepKey=(key:string)=>{const old=sourceSteps.find(n=>stepKey(n.id)===key);return old?[...replacements.values(),...additions].find(n=>n.id===mapping.get(old.id))?.canonicalKey.split(':').at(-1)??key:key;};
  const landscape=target!.landscape??source!.landscape;
  const mergedWorkflow:Workflow={...target!,reviewContext:{...context,summary:context?.summary??target!.summary??'',trigger:context?.trigger??target!.trigger??null,outcome:context?.outcome??target!.outcome??null,
    questions:unique([...(context?.questions??[]),...(other?.questions??[]),...(differingConnections?[{question:'二つの原文で違う手順のつながりは、どちらの運用を採用しますか？',reason:'統合先にない追加の接続は、原文の記載差として未確認で残しています。人が加えた手順や接続も保持しています。',target:'handoff' as const}]:[])]),warnings:unique([...(context?.warnings??[]),...(other?.warnings??[])]),
    documentEvidence:unique([...(context?.documentEvidence??[]),...(other?.documentEvidence??[])]),
    followUpAnswers:unique([...(context?.followUpAnswers??[]),...(other?.followUpAnswers??[])]),
    excludedSteps:unique([...(context?.excludedSteps??[]),...(other?.excludedSteps??[]).map(s=>({...s,stepKey:`merged-${encodeURIComponent(sourceId)}-${s.stepKey}`}))]),
    protectedDetails:unique([...(context?.protectedDetails??[]),...(other?.protectedDetails??[]).map(p=>({...p,stepKey:mappedStepKey(p.stepKey)}))]),
    systemProfiles:unique([...(context?.systemProfiles??[]),...(other?.systemProfiles??[])]),systemDependencies:unique([...(context?.systemDependencies??[]),...(other?.systemDependencies??[])])},
    ...(landscape?{landscape:{...landscape,domains:ids([...(target!.landscape?.domains??[]),...(source!.landscape?.domains??[])]),materialHandoffs:unique([...(target!.landscape?.materialHandoffs??[]),...(source!.landscape?.materialHandoffs??[])])}}:{})};
  const next:LensGraph={...graph,workflows:graph.workflows.filter(w=>w.id!==sourceId).map(w=>{
    const updated=w.id===targetId?mergedWorkflow:w;
    return {...updated,...(updated.basedOnWorkflowId===sourceId?{basedOnWorkflowId:targetId}:{}),...(updated.familyId===sourceId?{familyId:target!.familyId??targetId}:{}),
      ...(updated.landscape?{landscape:{...updated.landscape,materialHandoffs:updated.landscape.materialHandoffs.map(h=>({...h,targetWorkflowId:workflowId(h.targetWorkflowId)}))}}:{})};
  }),nodes:[...graph.nodes.filter(n=>!sourceById.has(n.id)).map(n=>replacements.get(n.id)??n),...additions],edges,dataFlows,
    knowledge:{...knowledge,activities:knowledge.activities.map(a=>({...a,capabilities:a.capabilities.map(c=>({...c,workflowIds:ids(c.workflowIds.map(workflowId))}))})),
      systems:knowledge.systems.map(s=>({...s,sourceWorkflowId:s.sourceWorkflowId?workflowId(s.sourceWorkflowId):undefined,dependsOn:s.dependsOn.map(d=>({...d,sourceWorkflowId:d.sourceWorkflowId?workflowId(d.sourceWorkflowId):undefined}))})),
      criticalWorkflows:unique(knowledge.criticalWorkflows.map(c=>({...c,workflowId:workflowId(c.workflowId)}))),handoffs}};
  const nextNotes={...transcripts,[targetId]:[transcripts[targetId]??'',`【同じ業務としてまとめた話：${source!.name}】\n${transcripts[sourceId]??''}`].filter(Boolean).join('\n\n')};delete nextNotes[sourceId];
  const byId=<T extends {id:string},>(item:T)=>item.id;
  const changes:MergeChanges={workflows:delta(graph.workflows,next.workflows,byId),nodes:delta(graph.nodes,next.nodes,byId),edges:delta(graph.edges,next.edges,byId),dataFlows:delta(graph.dataFlows,next.dataFlows,byId),
    activities:delta(knowledge.activities,next.knowledge!.activities,byId),systems:delta(knowledge.systems,next.knowledge!.systems,s=>s.systemId),criticalWorkflows:delta(knowledge.criticalWorkflows,next.knowledge!.criticalWorkflows,c=>`${c.workflowId}:${c.reason}`),handoffs:delta(knowledge.handoffs??[],handoffs,byId),
    transcripts:ids([sourceId,targetId]).map(key=>({key,before:transcripts[key]??null,after:nextNotes[key]??null}))};
  return {graph:next,transcripts:nextNotes,changes,count:{combined:assigned.length,added:additions.length,handoffs:changes.handoffs.length}};
}

export function commitWorkflowMerge(input:MergeInput,meta:{id:string;createdAt:string;updatedBy:string}) {
  const result=previewWorkflowMerge(input),source=input.graph.workflows.find(w=>w.id===input.sourceId)!,target=input.graph.workflows.find(w=>w.id===input.targetId)!;
  const record:WorkflowMergeRecord={...meta,sourceWorkflowId:source.id,targetWorkflowId:target.id,sourceName:source.name,targetName:target.name,state:'merged',choices:input.choices,
    changes:result.changes,targetAfter:fragment(result.graph,target.id,result.transcripts)};
  result.graph.knowledge={...result.graph.knowledge!,workflowMerges:[...(input.graph.knowledge?.workflowMerges??[]),record]};
  return {...result,record};
}
function restore<T>(items:T[],changes:Change<T>[],key:(item:T)=>string):T[]{
  for(const change of changes){const current=items.find(item=>key(item)===change.key)??null;if(mergeValue(current)!==mergeValue(change.after))throw new Error('統合後に関係する内容が変わっています。変更を保つため、元に戻す操作を止めました。');}
  const touched=new Set(changes.map(c=>c.key));return [...items.filter(item=>!touched.has(key(item))),...changes.flatMap(c=>c.before===null?[]:[c.before])];
}
export function undoWorkflowMerge(graph:LensGraph,transcripts:Record<string,string>,recordId:string,at:string){
  const record=graph.knowledge?.workflowMerges?.find(r=>r.id===recordId&&r.state==='merged');if(!record)throw new Error('元に戻せる統合が見つかりません。');
  if(fragment(graph,record.targetWorkflowId,transcripts)!==record.targetAfter)throw new Error('統合後に業務の流れや原文が変わっています。変更を保つため、元に戻す操作を止めました。');
  const c=record.changes,k=graph.knowledge!,byId=<T extends {id:string},>(item:T)=>item.id;
  const next:LensGraph={...graph,workflows:restore(graph.workflows,c.workflows,byId),nodes:restore(graph.nodes,c.nodes,byId),edges:restore(graph.edges,c.edges,byId),dataFlows:restore(graph.dataFlows,c.dataFlows,byId),knowledge:{...k,
    activities:restore(k.activities,c.activities,byId),systems:restore(k.systems,c.systems,s=>s.systemId),criticalWorkflows:restore(k.criticalWorkflows,c.criticalWorkflows,s=>`${s.workflowId}:${s.reason}`),handoffs:restore(k.handoffs??[],c.handoffs,byId),
    workflowMerges:k.workflowMerges!.map(r=>r.id===recordId?{...r,state:'undone',undoneAt:at}:r)}};
  const nextNotes={...transcripts};for(const change of c.transcripts){if(mergeValue(nextNotes[change.key]??null)!==mergeValue(change.after))throw new Error('統合後に原文が変わっています。');if(change.before===null)delete nextNotes[change.key];else nextNotes[change.key]=change.before;}
  return {graph:next,transcripts:nextNotes,restoredId:record.sourceWorkflowId};
}
