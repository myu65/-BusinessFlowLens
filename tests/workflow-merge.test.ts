import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorkflowReviewFromGraph,getWorkflowProcesses,type ExtractionReview,type LensGraph,type Workflow } from '../lib/graph';
import { extractGroundedLocal } from '../lib/local-review';
import { describeHumanEdit,notesAfterSave,previewReviewGraph } from '../lib/review-workbench';
import { commitWorkflowMerge,mergeStepDifferences,mergeValue,previewWorkflowMerge,undoWorkflowMerge,workflowMergeChoices,workflowMergeDestination,workflowMergeProblem } from '../lib/workflow-merge';
import { emptyInputKnowledge } from '../lib/input-knowledge';
import { SqliteBusinessFlowRepository } from '../lib/storage/sqlite';
import { ProjectChangedError } from '../lib/storage/repository';

function fixture(){
  const actions=['メールで成績書を受け取る','成績書と規格を比べて確認する','Teamsで品質課長へ知らせる'];
  function review(owner:string,doc:string,count:number):ExtractionReview{
    const base=extractGroundedLocal(actions.join('。'));
    return {...base,summary:'成績書を受け取り品質を確かめる',organization:null,steps:actions.slice(0,count).map((action,i)=>({...base.steps[0],stepKey:`s${i}`,order:i+1,name:action,action,actor:i===1?owner:'購買担当',department:'品質管理',evidence:`${owner}が${action}`,systems:[{name:i===2?'Teams':'Outlook',interaction:'other' as const,evidence:action}],data:[{name:'検査成績書',operation:i===0?'receive' as const:'read' as const,evidence:action}],sourceRefs:[{documentId:doc,unitId:'page1'}],humanEdits:i===1?[{field:'actor',before:null,after:owner,evidence:`担当者に${owner}と確認`}]:[],
      meaning:{purpose:'品質を確かめる',basis:'検査成績書と規格',result:action,next:'',condition:'',halt:false,certainty:'confirmed' as const,evidence:action}})),
      transitions:actions.slice(0,count-1).map((action,i)=>({fromStepKey:`s${i}`,toStepKey:`s${i+1}`,condition:null,evidence:action,certainty:'confirmed' as const,sourceRefs:[{documentId:doc,unitId:'page1'}]})),dataFlows:[],questions:[],warnings:[],documentEvidence:[{documentId:doc,documentName:doc+'.pdf',sha256:doc,itemId:'work',unitIds:['page1']}]};
  }
  const source:Workflow={id:'source',name:'成績書の確認を行う',scenario:'current'},target:Workflow={id:'target',name:'委託検査の成績書を確認する',scenario:'current'},down:Workflow={id:'down',name:'原料を受け入れる',scenario:'current'};
  let graph:LensGraph={workflows:[],nodes:[],edges:[],dataFlows:[],knowledge:emptyInputKnowledge()};
  graph=previewReviewGraph(graph,source,review('品質担当','doc-source',3));graph=previewReviewGraph(graph,target,review('購買担当','doc-target',2));graph=previewReviewGraph(graph,down,review('工場担当','doc-down',1));
  const from=getWorkflowProcesses(graph,source.id)[1],to=getWorkflowProcesses(graph,down.id)[0];
  graph.knowledge={...graph.knowledge!,activities:[{id:'quality',name:'品質を確かめる',description:'',capabilities:[{id:'check',name:'成績書を確かめる',description:'',workflowIds:['source','target','down']}]}],criticalWorkflows:[{workflowId:'source',reason:'受入を止める判断'}],handoffs:[{id:'delivery',sourceWorkflowId:'source',targetWorkflowId:'down',sourceProcessId:from.id,targetProcessId:to.id,dataIds:[],dataNames:['合否'],description:'合否を受入へ渡す',kind:'information',evidence:'品質担当が受入へ合否を渡す',status:'confirmed',origin:'human',reviewedWorkflowId:'source'}]};
  const choices=workflowMergeChoices(graph,'source','target').map(c=>({...c,...(c.targetProcessId?{keep:'source' as const}:{})}));
  return {graph,transcripts:{source:'品質担当が成績書を確認する。Teamsで品質課長へ知らせる。',target:'購買担当が成績書を確認する。',down:'工場担当が合否を受け取る。'},sourceId:'source',targetId:'target',choices};
}
const meta={id:'merge1',createdAt:'2026-10-05T00:00:00Z',updatedBy:'qa-user'};

test('merge preview keeps extra work, both originals, human corrections and the downstream handoff',()=>{
  const input=fixture(),before=mergeValue(input.graph),result=previewWorkflowMerge(input);
  assert.equal(mergeValue(input.graph),before,'preview does not mutate the live graph');
  assert.equal(result.graph.workflows.length,2);assert.equal(getWorkflowProcesses(result.graph,'target').length,3);
  assert.equal(result.count.combined,2);assert.equal(result.count.added,1);
  const step=getWorkflowProcesses(result.graph,'target')[1];assert.equal(step.actor,'品質担当');
  assert.ok(step.humanEdits?.some(e=>e.evidence==='担当者に購買担当と確認'));
  assert.ok(step.humanEdits?.some(e=>e.evidence==='担当者に品質担当と確認'));
  assert.equal(step.humanEdits?.at(-1)?.after,'品質担当');
  assert.deepEqual(new Set(step.sourceRefs?.map(r=>r.documentId)),new Set(['doc-source','doc-target']));
  assert.ok(result.transcripts.target.includes(input.transcripts.source));assert.ok(result.transcripts.target.includes(input.transcripts.target));assert.equal(result.transcripts.source,undefined);
  const handoff=result.graph.knowledge!.handoffs![0];assert.equal(handoff.sourceWorkflowId,'target');assert.equal(handoff.sourceProcessId,step.id);assert.equal(handoff.targetWorkflowId,'down');
  assert.deepEqual(result.graph.knowledge!.activities[0].capabilities[0].workflowIds,['target','down']);
  assert.equal(result.graph.knowledge!.criticalWorkflows[0].workflowId,'target');
  const read=buildWorkflowReviewFromGraph(result.graph,'target');assert.equal(read.documentEvidence?.length,2);assert.equal(read.handoffs?.[0]?.fromStepKey,step.canonicalKey.split(':').at(-1));
  assert.ok(result.graph.edges.every(e=>result.graph.nodes.some(n=>n.id===e.source)&&result.graph.nodes.some(n=>n.id===e.target)));
});

test('different content requires a person to choose; matching names do not merge uncertain or duplicate steps',()=>{
  const input=fixture(),choices=workflowMergeChoices(input.graph,'source','target');
  assert.equal(choices[1].keep,undefined);
  assert.ok(mergeStepDifferences(getWorkflowProcesses(input.graph,'source')[1],getWorkflowProcesses(input.graph,'target')[1],input.graph).includes('担当'));
  assert.throws(()=>previewWorkflowMerge({...input,choices}),/対応/);
  assert.throws(()=>previewWorkflowMerge({...input,choices:[input.choices[0],{...input.choices[1],targetProcessId:input.choices[0].targetProcessId},input.choices[2]]}),/二つ以上/);
  const repeated=structuredClone(input.graph),first=getWorkflowProcesses(repeated,'target')[0];repeated.nodes.push({...first,id:'extra',canonicalKey:'process:target:extra',stepOrder:4});
  assert.equal(workflowMergeChoices(repeated,'source','target')[0].targetProcessId,undefined);
});

test('current, future, sites and effective dates remain separate',()=>{
  const input=fixture(),source=input.graph.workflows[0],target=input.graph.workflows[1];
  assert.match(workflowMergeProblem(source,{...target,scenario:'future'})!,/将来案/);
  const landscape={domains:[],site:'',productId:'',productLabel:'',perspective:'',commonProcessId:'',processRole:'independent' as const,variantNote:'',evidence:'',materialHandoffs:[]};
  assert.match(workflowMergeProblem({...source,landscape:{...landscape,site:'東工場'}},{...target,landscape:{...landscape,site:'西工場'}})!,/拠点/);
  assert.match(workflowMergeProblem(source,{...target,effectiveFrom:'2027-01-01'})!,/期間/);
  const doc={documentId:'d',documentName:'d.pdf',sha256:'hash',itemId:'i',unitIds:['p1']},context={summary:'',trigger:null,outcome:null,questions:[],warnings:[],documentEvidence:[doc]};
  assert.match(workflowMergeProblem({...source,scenarioLabel:'東工場',reviewContext:context},{...target,scenarioLabel:'西工場',reviewContext:context})!,/拠点/,'the displayed scope of older document imports is also honored');
});

test('a shortcut from another original remains an unresolved variant, preserving a human-inserted handoff',()=>{
  const input=fixture(),[first,second]=getWorkflowProcesses(input.graph,'target');
  const bridge={...first,id:'human-bridge',canonicalKey:'process:target:human-bridge',stepOrder:1.5,label:'Teamsで品質へ渡す',action:'Teamsで品質へ渡す',humanEdits:[{field:'action',before:null,after:'Teamsで品質へ渡す',evidence:'購買担当に確認'}]};
  input.graph.nodes.push(bridge);input.graph.edges=input.graph.edges.filter(e=>!(e.source===first.id&&e.target===second.id&&e.relation==='next'));
  input.graph.edges.push({id:'first-bridge',source:first.id,target:bridge.id,relation:'next',workflowIds:['target'],status:'confirmed',evidence:'購買担当に確認'},{id:'bridge-second',source:bridge.id,target:second.id,relation:'next',workflowIds:['target'],status:'confirmed',evidence:'購買担当に確認'});
  const merged=previewWorkflowMerge(input),shortcut=merged.graph.edges.find(e=>e.source===first.id&&e.target===second.id&&e.relation==='next')!;
  assert.equal(shortcut.status,'unknown');assert.equal(shortcut.sourceVariant,'document_conflict');
  assert.ok(merged.graph.edges.some(e=>e.source===first.id&&e.target===bridge.id));assert.ok(merged.graph.edges.some(e=>e.source===bridge.id&&e.target===second.id));
  assert.ok(merged.graph.workflows.find(w=>w.id==='target')?.reviewContext?.questions.some(q=>q.question.includes('どちらの運用')));
});

test('a two-workflow preview stays bounded with 300 accumulated workflows and preserves unrelated processes',()=>{
  const input=fixture(),base=getWorkflowProcesses(input.graph,'down')[0];
  for(let i=0;i<297;i++){
    const workflowId=`unrelated-${i}`;input.graph.workflows.push({id:workflowId,name:'独立した仕事'+i});
    for(let j=0;j<8;j++){const id=`other-${i}-${j}`,canonicalKey=`process:${workflowId}:s${j}`;input.graph.nodes.push({...base,id,canonicalKey,workflowId,stepOrder:j+1});input.graph.edges.push({id:'uses-'+id,source:id,target:input.graph.nodes.find(n=>n.kind==='system')!.id,relation:'uses',workflowIds:[workflowId]});}
  }
  const start=performance.now(),result=previewWorkflowMerge(input);assert.ok(performance.now()-start<3000,'the merge does not pair every company process or edge with every other one');
  assert.equal(result.graph.workflows.length,299);assert.equal(result.graph.nodes.filter(n=>n.workflowId?.startsWith('unrelated-')).length,297*8);
});

test('undo restores original identities and affected relations while keeping an unrelated added workflow',()=>{
  const input=fixture(),merged=commitWorkflowMerge(input,meta),later={...merged.graph,workflows:[...merged.graph.workflows,{id:'unrelated',name:'設備を掃除する'}]};
  assert.equal(workflowMergeDestination(merged.graph,'source'),'target');
  const restored=undoWorkflowMerge(later,{...merged.transcripts,unrelated:'独立した新しい話'},meta.id,'2026-10-05T01:00:00Z');
  assert.equal(restored.graph.workflows.length,4);assert.deepEqual(getWorkflowProcesses(restored.graph,'source'),getWorkflowProcesses(input.graph,'source'));
  assert.deepEqual(getWorkflowProcesses(restored.graph,'target'),getWorkflowProcesses(input.graph,'target'));
  assert.deepEqual(restored.graph.knowledge?.handoffs,input.graph.knowledge?.handoffs);assert.equal(restored.transcripts.unrelated,'独立した新しい話');
  assert.equal(restored.graph.knowledge?.workflowMerges?.[0].state,'undone');assert.equal(restored.transcripts.source,input.transcripts.source);assert.equal(restored.transcripts.target,input.transcripts.target);
  assert.equal(workflowMergeDestination(restored.graph,'source'),'source');
  assert.throws(()=>undoWorkflowMerge(restored.graph,restored.transcripts,meta.id,''),/見つかりません/);
});

test('undo refuses to overwrite subsequent edits or new connections to merged work',()=>{
  const input=fixture(),merged=commitWorkflowMerge(input,meta),edited=structuredClone(merged.graph);
  getWorkflowProcesses(edited,'target')[0].actor='新しい担当';assert.throws(()=>undoWorkflowMerge(edited,merged.transcripts,meta.id,''),/変わっています/);
  const newConnection=structuredClone(merged.graph);newConnection.knowledge!.handoffs!.push({...newConnection.knowledge!.handoffs![0],id:'later'});
  assert.throws(()=>undoWorkflowMerge(newConnection,merged.transcripts,meta.id,''),/変わっています/);
  assert.throws(()=>undoWorkflowMerge(merged.graph,{...merged.transcripts,target:'後で直した原文'},meta.id,''),/変わっています/);
});

test('SQLite round trip retains a reversible merge, original file bytes and independent revision history',async()=>{
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),'bfl-merge-')),'qa.sqlite')),input=fixture();
  const snapshot={projectId:'qa',projectName:'QA',graph:input.graph,transcripts:input.transcripts,updatedAt:meta.createdAt};
  await repo.saveProject(snapshot);const persisted=(await repo.loadProject('qa'))!;
  const review=buildWorkflowReviewFromGraph(persisted.graph,'source');
  await repo.appendWorkflowRevision({projectId:'qa',workflowId:'source',workflowName:'成績書を確認する',sourceNotes:input.transcripts.source,followUpAnswers:[],review,updatedBy:'human',createdAt:meta.createdAt});
  await repo.saveSourceDocument('qa',{id:'doc-source',name:'図.pdf',format:'pdf',sha256:'source-hash',byteSize:4,createdAt:meta.createdAt,units:[{id:'page1',location:'1ページ',text:'成績書を確認する'}],warnings:[]},new Uint8Array([1,2,3,4]));
  const merged=commitWorkflowMerge({...input,graph:persisted.graph,transcripts:persisted.transcripts,choices:workflowMergeChoices(persisted.graph,'source','target').map(c=>({...c,...(c.targetProcessId?{keep:'source' as const}:{})}))},meta);
  await repo.saveProject({...persisted,graph:merged.graph,transcripts:merged.transcripts,updatedAt:'merged'},persisted.updatedAt);
  const after=(await repo.loadProject('qa'))!;
  const undone=undoWorkflowMerge(after.graph,after.transcripts,meta.id,'undone');
  await repo.saveProject({...after,...undone,updatedAt:'restored'},after.updatedAt);
  const restored=(await repo.loadProject('qa'))!;assert.equal(restored.graph.workflows.length,3);assert.equal(restored.transcripts.source,input.transcripts.source);
  assert.deepEqual((await repo.getSourceDocument('qa','doc-source'))!.bytes,new Uint8Array([1,2,3,4]));assert.equal((await repo.listWorkflowRevisions('qa','source')).length,1);
  await assert.rejects(repo.saveProject({...restored,transcripts:{},updatedAt:'stale'},'merged'),ProjectChangedError);
  assert.equal((await repo.loadProject('qa'))!.updatedAt,'restored');
});

test('merge may start from an unsaved file candidate and remains reversible after persistence',async()=>{
  const repo=new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(),'bfl-merge-draft-')),'qa.sqlite')),input=fixture();
  // The same deterministic projection is used for candidate diagrams and the merge API.
  const draftReview=buildWorkflowReviewFromGraph(input.graph,'source'),draftWorkflow=input.graph.workflows[0];
  const savedGraph={...input.graph,workflows:input.graph.workflows.filter(w=>w.id!=='source'),nodes:input.graph.nodes.filter(n=>n.workflowId!=='source'),edges:input.graph.edges.filter(e=>!e.workflowIds.includes('source'))};
  await repo.saveProject({projectId:'qa',projectName:'QA',graph:savedGraph,transcripts:{target:input.transcripts.target,down:input.transcripts.down},updatedAt:'initial'});
  const saved=(await repo.loadProject('qa'))!,candidate=previewReviewGraph(saved.graph,draftWorkflow,draftReview),notes={...saved.transcripts,source:input.transcripts.source};
  const merged=commitWorkflowMerge({...input,graph:candidate,transcripts:notes,choices:workflowMergeChoices(candidate,'source','target').map(c=>({...c,...(c.targetProcessId?{keep:'target' as const}:{})}))},meta);
  await repo.saveProject({...saved,graph:merged.graph,transcripts:merged.transcripts,updatedAt:'merged'},saved.updatedAt);
  const after=(await repo.loadProject('qa'))!;const restored=undoWorkflowMerge(after.graph,after.transcripts,meta.id,'undo');
  assert.equal(restored.graph.workflows.length,3);assert.equal(restored.transcripts.source,input.transcripts.source);
});

test('server-updated originals replace stale saved notes while another unsaved story survives',()=>{
  assert.deepEqual(notesAfterSave({source:'a',target:'b',other:'c'},{target:'b plus a',other:'c'},{source:'a',target:'b',other:'new c',__new_memo__:'new story'},'source'),{target:'b plus a',other:'new c',__new_memo__:'new story'});
});

test('adopting an unconfirmed result can display the removed interpretation in human-readable history',()=>{
  assert.deepEqual(describeHumanEdit({field:'meaning',before:{result:'成績書を受け取ったので合格'},after:undefined,evidence:'合否は未確認と確認'}),['決まる・変わること：成績書を受け取ったので合格 → 未確認']);
});
