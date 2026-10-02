import fs from 'node:fs/promises';
import ts from 'typescript';
// In PowerShell, start a local-demo server with:
// $env:AI_MODEL=''; npm run start -- -p 3105
// Then run: node tests/workflow-regressions.mjs
await fs.mkdir('.data', {recursive:true});
for (const name of ['graph','ai/provider']) {
  const text = await fs.readFile(`lib/${name}.ts`,'utf8');
  await fs.writeFile(`.data/review-${name.replace('/','-')}.mjs`,ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const graphLib = await import('../.data/review-graph.mjs');
const cases=[];
function check(name,ok,detail) { cases.push({name,ok,detail}); }
async function api(route,method='GET',body) {
 const r=await fetch(`http://localhost:3105${route}`,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json()};
}
const workflow={id:'review-api-operations',name:'API総合確認',familyId:'review-api-operations',scenario:'current',effectiveFrom:'2026-10-01',effectiveTo:'2026-12-31'};
const operations=['read','create','update','send','receive'];
const review={summary:'操作の保存確認',trigger:'受付',outcome:'完了',steps:operations.map((op,i)=>({stepKey:`step-${i}`,name:`操作${op}`,order:i+1,actor:'確認担当',department:'確認部',responsiblePerson:'確認担当',executionMode:i===1?'automatic':i===2?'mixed':'manual',executingSystem:i===1||i===2?'検証ERP':null,action:'',certainty:'explicit',evidence:'手動検証',systems:[{name:'検証ERP',interaction:'view',evidence:'手動検証'}],data:[{name:`検証Data${op}`,operation:op,evidence:'手動検証'}]})),transitions:[],dataFlows:[{sourceSystem:'検証ERP',targetSystem:'検証WMS',data:['検証Dataread'],transferType:'file',direction:'bidirectional',automation:'mixed',frequency:'毎日',evidence:'手動検証',certainty:'explicit',relatedStepKeys:['step-1']}],questions:[{question:'担当部署は？',reason:'確認',target:'owner'}],warnings:[]};
const empty={workflows:[],nodes:[],edges:[],dataFlows:[]};
const first=await api('/api/apply','POST',{projectId:'review-api-cases',workflow,graph:empty,review,transcripts:{[workflow.id]:'確認メモ'},sourceNotes:'確認メモ',followUpAnswers:[{question:'担当部署は？',answer:'確認部'}]});
if(first.status!==200) throw new Error(JSON.stringify(first));
const graph=first.body.graph;
check('blank_actions_preserved',graph.nodes.filter(n=>n.kind==='process').length===5);
check('no_invented_transitions',!graph.edges.some(e=>e.relation==='next'));
check('execution_edges',graph.edges.filter(e=>e.relation==='executes').length===2);
check('dataflow_method_direction_frequency',graph.dataFlows[0].transferType==='file'&&graph.dataFlows[0].direction==='bidirectional'&&graph.dataFlows[0].frequency==='毎日');
const reconstructed=graphLib.buildWorkflowReviewFromGraph(graph,workflow.id);
check('summary_trigger_outcome_roundtrip',reconstructed.summary===review.summary&&reconstructed.trigger===review.trigger&&reconstructed.outcome===review.outcome,{before:{summary:review.summary,trigger:review.trigger,outcome:review.outcome},after:{summary:reconstructed.summary,trigger:reconstructed.trigger,outcome:reconstructed.outcome}});
check('data_operations_roundtrip',JSON.stringify(reconstructed.steps.map(s=>s.data[0]?.operation))===JSON.stringify(operations),{before:operations,after:reconstructed.steps.map(s=>s.data[0]?.operation)});
const second = await api('/api/apply','POST',{projectId:'review-api-cases',workflow,graph,review:reconstructed,transcripts:{[workflow.id]:'確認メモ'}});
const secondReview = graphLib.buildWorkflowReviewFromGraph(second.body.graph,workflow.id);
check('second_save_preserves_metadata_and_operations',secondReview.summary===review.summary&&secondReview.trigger===review.trigger&&secondReview.outcome===review.outcome&&JSON.stringify(secondReview.steps.map(s=>s.data[0]?.operation))===JSON.stringify(operations));
const original = await api('/api/workflow-revisions?projectId=review-api-cases&revisionId='+first.body.revision.id);
check('history_snapshot_and_qa',original.body.revision.review.steps[1].data[0].operation==='create'&&original.body.revision.followUpAnswers[0].answer==='確認部'&&original.body.revision.effectiveFrom==='2026-10-01');
const refinement=await api('/api/extract','POST',{workflow,graph,interview:'確認メモ',previousReview:review,followUpAnswers:[{question:'担当部署は？',answer:'確認部'}]});
check('followup_ui_contract_local_demo',refinement.status===200&&refinement.body.review.questions.length===0&&refinement.body.review.steps.length===5,{provider:refinement.body.provider});
const interview='営業がメールで注文書を受け取り、ERPで在庫を確認し、出荷手配をします。';
const freshReview=graphLib.buildWorkflowReviewFromGraph({...empty,workflows:[workflow]},workflow.id);
const freshDraft=await api('/api/extract','POST',{workflow,graph:empty,interview,previousReview:freshReview});
const baselineDraft=await api('/api/extract','POST',{workflow,graph:empty,interview,previousReview:null});
check('new_workflow_demo_extraction',freshDraft.body.review.steps.length>0,{current:freshDraft.body.review.steps.length,withoutEmptyPreviousReview:baselineDraft.body.review.steps.length});
const branch={id:'review-api-future',name:'API将来案',scenario:'future',effectiveFrom:'2027-04-01'};
const branched=graphLib.branchWorkflowScenario(graph,workflow.id,branch);
check('branch_clones_processes_and_execution',branched.nodes.filter(n=>n.workflowId===branch.id).length===5&&branched.edges.filter(e=>e.workflowIds.includes(branch.id)&&e.relation==='executes').length===2);
check('branch_shared_assets',branched.nodes.filter(n=>n.kind!=='process').length===graph.nodes.filter(n=>n.kind!=='process').length);
check('effective_date_boundaries',graphLib.isWorkflowEffectiveOn(workflow,'2026-10-01')&&graphLib.isWorkflowEffectiveOn(workflow,'2026-12-31')&&!graphLib.isWorkflowEffectiveOn(workflow,'2027-01-01'));
const persistedBranch=await api('/api/project','PUT',{projectId:'review-api-cases',projectName:'確認用',graph:branched,transcripts:{[workflow.id]:'確認メモ',[branch.id]:'確認メモ'}});
const reloaded=await api('/api/project?projectId=review-api-cases');
check('branch_sqlite_reload',persistedBranch.status===200&&reloaded.body.project.graph.workflows.some(w=>w.id===branch.id&&w.effectiveFrom==='2027-04-01'));
const branchReview=graphLib.buildWorkflowReviewFromGraph(reloaded.body.project.graph,branch.id);
check('branch_metadata_sqlite_reload',branchReview.summary===review.summary&&branchReview.trigger===review.trigger&&branchReview.outcome===review.outcome);
const deletedReview={...review,steps:review.steps.filter(s=>s.stepKey!=='step-1'),dataFlows:review.dataFlows.map(f=>({...f,relatedStepKeys:[]}))};
const removed=await api('/api/apply','POST',{projectId:'review-api-cases',workflow,graph:reloaded.body.project.graph,review:deletedReview,transcripts:{[workflow.id]:'確認メモ',[branch.id]:'確認メモ'}});
const removedGraph=removed.body.graph;
const ids=new Set(removedGraph.nodes.map(n=>n.id));
check('delete_persisted_no_dangling_edges',removed.status===200&&removedGraph.nodes.filter(n=>n.workflowId===workflow.id).length===4&&removedGraph.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
check('delete_does_not_change_other_scenario',removedGraph.nodes.filter(n=>n.workflowId===branch.id).length===5&&removedGraph.edges.filter(e=>e.workflowIds.includes(branch.id)&&e.relation==='executes').length===2);
for (const route of ['/api/extract','/api/apply','/api/project']) {
 const bad=await api(route,route==='/api/project'?'PUT':'POST',{});
 check('validation_'+route,bad.status===400,{status:bad.status});
}
await fs.writeFile('.data/review-remaining-results.json',JSON.stringify(cases,null,2));
console.log(JSON.stringify(cases,null,2));
if (cases.some(item => !item.ok)) process.exitCode = 1;

