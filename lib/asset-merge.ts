import type { CompanyKnowledge, LensGraph, LensNode } from './graph';
import { mergeAssets } from './refinement';
import { emptyInputKnowledge } from './input-knowledge';
import { mergeValue } from './workflow-merge';

type Change<T>={key:string;before:T|null;after:T|null};
type AssetChanges={
  nodes:Change<LensGraph['nodes'][number]>[];edges:Change<LensGraph['edges'][number]>[];dataFlows:Change<LensGraph['dataFlows'][number]>[];
  workflows:Change<LensGraph['workflows'][number]>[];systems:Change<CompanyKnowledge['systems'][number]>[];handoffs:Change<NonNullable<CompanyKnowledge['handoffs']>[number]>[];
};
export type AssetMutationRecord={id:string;createdAt:string;updatedBy:string;state:'applied'|'undone';undoneAt?:string;kind:'merge'|'rename';sourceId:string;targetId:string;sourceName:string;targetName:string;evidence:string;changes:AssetChanges;targetAfter:string};
export type AssetMutationInput={graph:LensGraph;sourceId:string;targetId?:string;name?:string;evidence:string;acceptTargetProfile?:boolean};
const delta=<T,>(before:T[],after:T[],key:(item:T)=>string):Change<T>[]=>{
  const a=new Map(before.map(x=>[key(x),x])),b=new Map(after.map(x=>[key(x),x]));
  return [...new Set([...a.keys(),...b.keys()])].flatMap(k=>mergeValue(a.get(k)??null)===mergeValue(b.get(k)??null)?[]:[{key:k,before:a.get(k)??null,after:b.get(k)??null}]);
};
const byId=<T extends{id:string},>(item:T)=>item.id;
const fragment=(graph:LensGraph,id:string)=>mergeValue({node:graph.nodes.find(n=>n.id===id),edges:graph.edges.filter(e=>e.source===id||e.target===id),flows:graph.dataFlows.filter(f=>f.sourceSystemId===id||f.targetSystemId===id||f.dataIds.includes(id)),profiles:graph.knowledge?.systems.filter(p=>p.systemId===id||p.dependsOn.some(d=>d.systemId===id)),handoffs:graph.knowledge?.handoffs?.filter(h=>h.dataIds.includes(id)||h.dataBindings?.some(b=>b.dataId===id))});

export function assetProfileConflicts(graph:LensGraph,source:LensNode,target:LensNode){
  const meaningful=(n:LensNode)=>n.description&&n.description!==n.label?n.description:'';
  const conflicts=meaningful(source)&&meaningful(target)&&meaningful(source)!==meaningful(target)?['説明']:[];
  const a=graph.knowledge?.systems.find(p=>p.systemId===source.id),b=graph.knowledge?.systems.find(p=>p.systemId===target.id);
  if(a&&b)for(const [key,label]of [['owner','管理部署'],['purpose','用途'],['categoryId','分類']] as const)if(a[key]&&b[key]&&a[key]!==b[key])conflicts.push(label);
  return conflicts;
}

/** Original nodes, profiles, bindings and relations are archived in the reversible delta. */
export function previewAssetMutation(input:AssetMutationInput){
  const {graph,sourceId,targetId,name,evidence}=input;
  const source=graph.nodes.find(n=>n.id===sourceId),target=graph.nodes.find(n=>n.id===targetId);
  if(!source||source.kind==='process'||!evidence.trim())throw new Error('対象のシステムまたは情報と、変更する理由を指定してください。');
  let next:LensGraph;
  if(targetId){
    if(!target||target.kind!==source.kind||target.id===source.id)throw new Error('同じ種類の異なるシステムまたは情報を指定してください。');
    const conflicts=assetProfileConflicts(graph,source,target);
    if(conflicts.length&&!input.acceptTargetProfile)throw new Error(`${source.label}と${target.label}では${conflicts.join('・')}が違います。${target.label}の内容を採用して、もう一方を履歴に残しますか？`);
    next=mergeAssets(graph,sourceId,targetId);
    const binding=(items:import('./graph').HandoffDataBinding[]|undefined)=>items?.map(b=>({...b,dataId:b.dataId===sourceId?targetId:b.dataId}));
    next={...next,knowledge:next.knowledge?{...next.knowledge,handoffs:next.knowledge.handoffs?.map(h=>({...h,dataBindings:binding(h.dataBindings)}))}:undefined};
    next={...next,nodes:next.nodes.map(n=>n.id===targetId?{...n,humanEdits:[...(n.humanEdits??[]),{field:'identity',before:{id:sourceId,name:source.label},after:{id:targetId,name:target!.label},evidence}]}:n)};
  }else{
    if(!name?.trim()||name.length>120)throw new Error('新しい名前を120文字以内で指定してください。');
    next={...graph,nodes:graph.nodes.map(n=>n.id===sourceId?{...n,label:name.trim(),aliases:[...new Set([...(n.aliases??[]),n.label])].filter(a=>a!==name.trim()),humanEdits:[...(n.humanEdits??[]),{field:'label',before:n.label,after:name.trim(),evidence}]}:n)};
  }
  const a=graph.knowledge??emptyInputKnowledge(),b=next.knowledge??emptyInputKnowledge();
  const changes:AssetChanges={nodes:delta(graph.nodes,next.nodes,byId),edges:delta(graph.edges,next.edges,byId),dataFlows:delta(graph.dataFlows,next.dataFlows,byId),workflows:delta(graph.workflows,next.workflows,byId),systems:delta(a.systems,b.systems,p=>p.systemId),handoffs:delta(a.handoffs??[],b.handoffs??[],byId)};
  const assets=new Set([sourceId,...(targetId?[targetId]:[])]);
  const affectedWorkflows=[...new Set([
    ...graph.edges.filter(e=>assets.has(e.source)||assets.has(e.target)).flatMap(e=>e.workflowIds),
    ...graph.dataFlows.filter(f=>assets.has(f.sourceSystemId)||assets.has(f.targetSystemId)||f.dataIds.some(id=>assets.has(id))).flatMap(f=>f.workflowIds),
    ...(graph.knowledge?.handoffs??[]).filter(h=>h.dataIds.some(id=>assets.has(id))||h.dataBindings?.some(b=>assets.has(b.dataId))).flatMap(h=>[h.sourceWorkflowId,h.targetWorkflowId]),
  ])].filter(id=>graph.workflows.some(w=>w.id===id));
  return {graph:next,changes,affectedWorkflows,sourceName:source.label,targetName:target?.label??name!.trim()};
}

export function commitAssetMutation(input:AssetMutationInput,metadata:{id:string;createdAt:string;updatedBy:string}){
  const result=previewAssetMutation(input),id=input.targetId??input.sourceId;
  const record:AssetMutationRecord={...metadata,state:'applied',kind:input.targetId?'merge':'rename',sourceId:input.sourceId,targetId:id,sourceName:result.sourceName,targetName:result.targetName,evidence:input.evidence,changes:result.changes,targetAfter:fragment(result.graph,id)};
  return {...result,record,graph:{...result.graph,knowledge:{...(result.graph.knowledge??emptyInputKnowledge()),assetMutations:[...(input.graph.knowledge?.assetMutations??[]),record]}}};
}

export function undoAssetMutation(graph:LensGraph,recordId:string,at:string){
  const record=graph.knowledge?.assetMutations?.find(r=>r.id===recordId&&r.state==='applied');
  if(!record)throw new Error('元に戻せるシステム・情報の変更が見つかりません。');
  if(fragment(graph,record.targetId)!==record.targetAfter)throw new Error('変更後に関係する構造が更新されています。追加された内容を保つため、元に戻す操作を止めました。');
  const restore=<T,>(items:T[],changes:Change<T>[],key:(item:T)=>string)=>{
    for(const c of changes)if(mergeValue(items.find(x=>key(x)===c.key)??null)!==mergeValue(c.after))throw new Error('変更後に関係する内容が更新されています。最新の内容を確かめてください。');
    const ids=new Set(changes.map(c=>c.key));return [...items.filter(x=>!ids.has(key(x))),...changes.flatMap(c=>c.before===null?[]:[c.before])];
  };
  const c=record.changes,k=graph.knowledge!;
  return {...graph,nodes:restore(graph.nodes,c.nodes,byId),edges:restore(graph.edges,c.edges,byId),dataFlows:restore(graph.dataFlows,c.dataFlows,byId),workflows:restore(graph.workflows,c.workflows,byId),knowledge:{...k,systems:restore(k.systems,c.systems,p=>p.systemId),handoffs:restore(k.handoffs??[],c.handoffs,byId),assetMutations:k.assetMutations!.map(r=>r.id===recordId?{...r,state:'undone' as const,undoneAt:at}:r)}};
}
