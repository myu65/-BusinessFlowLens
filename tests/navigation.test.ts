import test from 'node:test';
import assert from 'node:assert/strict';
import { createChemicalCompany } from '../lib/chemical-company';
import { extractGroundedLocal } from '../lib/local-review';
import { NEW_MEMO_ID, previewReviewGraph, type InputDraft } from '../lib/review-workbench';
import { assetPosition, flowLinkId, knowledgeLocation, knowledgePosition, readScreenLocation, resolveScreenLocation, shouldPushScreenHistory, screenURL, type ScreenLocation } from '../lib/navigation';
import { SqliteBusinessFlowRepository } from '../lib/storage/sqlite';

const graph = createChemicalCompany();
const workflow = graph.workflows[0], step = graph.nodes.find(n => n.workflowId === workflow.id && n.kind === 'process')!;
const system = graph.nodes.find(n => n.kind === 'system')!, data = graph.nodes.find(n => n.kind === 'data')!;
const activity = graph.knowledge!.activities[0], capability = activity.capabilities[0];

test('all main screens and company, activity, capability and system links open the requested subject', () => {
  for (const [view, expected] of [['input','interviews'],['company','company'],['workflow','workflow'],['dataflow','dataflow'],['assets','assets'],['overview','overview']] as const) {
    assert.equal(readScreenLocation(`?projectId=test&view=${view}`).location.view, expected);
  }
  for (const query of [`view=company&activityId=${activity.id}`, `view=activity&activityId=${activity.id}`, `view=capability&capabilityId=${capability.id}`, `view=assets&assetId=${system.id}`, `view=company&assetId=${data.id}`]) {
    const read = readScreenLocation(query), resolved = resolveScreenLocation(read.location, graph);
    assert.equal(resolved.notice, '');
    assert.equal(resolved.location.projectId, 'default');
    const roundTrip = readScreenLocation(screenURL('/', resolved.location).split('?')[1]).location;
    assert.equal(roundTrip.view, resolved.location.view);
    assert.deepEqual(roundTrip.focus, resolved.location.focus);
    assert.equal(roundTrip.assetId, resolved.location.assetId);
  }
  assert.deepEqual(readScreenLocation('view=systems').location.focus, {kind:'systems'});
  assert.equal(readScreenLocation('view=report').location.tab, 'report');
  assert.equal(readScreenLocation('view=data').location.kind,'data');
});

test('workflow links override the remembered input and retain step, information and depth', () => {
  const location = readScreenLocation(`?projectId=isolated&view=workflow&workflowId=${workflow.id}&stepId=${step.id}&dataId=${data.id}&depth=detail&lens=data`).location;
  const resolved = resolveScreenLocation(location, graph, {}, 'some-old-input');
  assert.equal(resolved.selectedId, workflow.id);
  assert.equal(resolved.location.stepId, step.id);
  assert.equal(resolved.location.depth, 'detail');
  assert.equal(resolved.location.lens, 'data');
  assert.equal(resolved.location.level, 'business');
  const onlyStep = resolveScreenLocation(readScreenLocation(`stepId=${step.id}`).location, graph);
  assert.equal(onlyStep.location.workflowId, workflow.id);
});

test('scope follows a named future workflow instead of showing an unrelated current workflow', () => {
  const future = graph.workflows.find(w => w.scenario === 'future')!;
  const result = resolveScreenLocation(readScreenLocation(`view=workflow&workflowId=${future.id}&scope=current`).location, graph);
  assert.equal(result.selectedId, future.id); assert.equal(result.location.scope, 'future'); assert.match(result.notice, /表示範囲/);
});

test('missing and mismatched subjects give a visible explanation and never select a different detail as the requested item', () => {
  for (const query of ['view=workflow&workflowId=missing', 'view=assets&assetId=missing', 'view=company&activityId=missing', 'view=company&capabilityId=missing']) {
    const result = resolveScreenLocation(readScreenLocation(query).location, graph);
    assert.equal(result.location.view, 'company'); assert.deepEqual(result.location.focus, {kind:'company'}); assert.ok(result.notice);
  }
  const result = resolveScreenLocation(readScreenLocation(`view=workflow&workflowId=${workflow.id}&stepId=missing`).location, graph);
  assert.equal(result.location.workflowId, workflow.id); assert.equal(result.location.stepId, undefined); assert.equal(result.location.level, 'overview'); assert.ok(result.notice);
  const otherStep = graph.nodes.find(n => n.kind === 'process' && n.workflowId !== workflow.id)!;
  const mismatch = resolveScreenLocation(readScreenLocation(`view=workflow&workflowId=${workflow.id}&stepId=${otherStep.id}`).location, graph);
  assert.equal(mismatch.location.workflowId, workflow.id); assert.equal(mismatch.location.stepId, undefined); assert.ok(mismatch.notice);
  const invalidWork = resolveScreenLocation(readScreenLocation(`view=workflow&workflowId=missing&stepId=${step.id}`).location, graph);
  assert.equal(invalidWork.location.view, 'company'); assert.equal(invalidWork.location.workflowId, undefined);
});

test('information transfers must belong to the requested workflow', () => {
  const flow = graph.dataFlows.find(f => !f.workflowIds.includes(workflow.id))!;
  const result = resolveScreenLocation({projectId:'test',view:'dataflow',workflowId:workflow.id,flowId:flow.id}, graph);
  assert.equal(result.location.workflowId, workflow.id); assert.equal(result.location.flowId, undefined); assert.ok(result.notice);
  const futureFlow = graph.dataFlows.find(f => f.workflowIds.some(id => graph.workflows.find(w=>w.id===id)?.scenario==='future'))!;
  if (futureFlow) assert.equal(resolveScreenLocation({projectId:'test',view:'dataflow',flowId:futureFlow.id},graph).location.scope, 'future');
});

test('information-transfer links contain an opaque ID, resolve the exact record, and reject ambiguous locators', () => {
  const flow=graph.dataFlows[0], snapshot=structuredClone(graph);
  const rawId=`${flow.id}--根拠：原文にしかない注文の説明`;
  snapshot.dataFlows[0].id=rawId;
  const url=screenURL('/',{projectId:'test',view:'dataflow',flowId:rawId});
  assert.doesNotMatch(decodeURIComponent(url),/原文|根拠|注文の説明/);
  const location=readScreenLocation(url.split('?')[1]).location;
  assert.match(location.flowId!,/^flow-[0-9a-f]{32}$/);
  const result=resolveScreenLocation(location,snapshot);
  assert.equal(result.location.flowId,rawId);assert.equal(result.location.workflowId,flow.workflowIds[0]);assert.equal(result.notice,'');
  assert.equal(shouldPushScreenHistory(location,{...location,flowId:rawId}),false);
  snapshot.dataFlows.push({...flow,id:flowLinkId(rawId)});
  const ambiguous=resolveScreenLocation(location,snapshot);
  assert.equal(ambiguous.location.flowId,undefined);assert.match(ambiguous.notice,/特定できません/);
});

test('a local unsaved candidate can be linked in its browser without mutating graph, draft or original note', () => {
  const draft = {workflow:{id:'draft-order',name:'入力途中の仕事'},review:extractGroundedLocal('営業がExcelで数量を確認する。'),sourceNotes:'営業がExcelで数量を確認する。'} as InputDraft;
  const drafts = {[NEW_MEMO_ID]:draft}, before = JSON.stringify({graph,drafts});
  const preview = previewReviewGraph(graph,draft.workflow,draft.review), process = preview.nodes.find(n=>n.workflowId===draft.workflow.id)!;
  const result = resolveScreenLocation({projectId:'test',view:'interviews',workflowId:'draft-order',stepId:process.id},graph,drafts);
  assert.equal(result.selectedId, NEW_MEMO_ID); assert.equal(result.notice,''); assert.equal(result.location.stepId,process.id);
  assert.equal(JSON.stringify({graph,drafts}),before);
  assert.match(resolveScreenLocation(result.location,graph).notice,/保存前/);
});

test('link round trips retain Japanese filters and tabs while preserving hosting path and unrelated parameters', () => {
  const location: ScreenLocation = {projectId:'会社 A',view:'assets',assetId:system.id,scope:'future',department:'品質管理',query:'試料 A&B',tab:'dependencies',kind:'system',page:2};
  const url=screenURL('https://test.invalid/app?hostContext=abc&view=input&workflowId=old&q=old#section',location);
  assert.ok(url.startsWith('/app?')); assert.ok(url.endsWith('#section'));
  const p=new URL(url,'https://test.invalid').searchParams;
  assert.equal(p.get('hostContext'),'abc'); assert.equal(p.get('workflowId'),null);
  assert.deepEqual(readScreenLocation(p.toString()).location,location);
  assert.equal(assetPosition(system.id,'dependencies').section,'dependencies');
  assert.equal(readScreenLocation('view=input&tab=history&mode=summary').location.tab,'history');
  assert.equal(readScreenLocation('view=input&tab=documents').location.tab,'documents');
});

test('old reader positions cannot leak into a company or system overview link', () => {
  const saved = knowledgePosition({projectId:'test',view:'company',focus:{kind:'company'},scope:'current',selectedActivityId:activity.id,page:1});
  const location=knowledgeLocation('test',{...saved,stepId:step.id,dataId:data.id,depth:'detail',lens:'data'});
  assert.equal(location.stepId,undefined);assert.equal(location.dataId,undefined);assert.equal(location.selectedActivityId,activity.id);assert.equal(location.page,1);
  assert.equal(resolveScreenLocation(location,graph).location.workflowId,undefined);
  const systemMap=knowledgeLocation('test',knowledgePosition({projectId:'test',view:'company',focus:{kind:'systems'},selectedSystemId:system.id,selectedCategoryId:'data',relationId:'one',relationPage:2,page:1}));
  const restored=knowledgePosition(readScreenLocation(screenURL('/',systemMap).split('?')[1]).location);
  assert.equal(restored.systemReading?.systemId,system.id);assert.equal(restored.systemReading?.relationPage,2);
});

test('a process detail and its selected reading step remain separate when a link is reopened', () => {
  const nextStep=graph.nodes.find(n=>n.workflowId===workflow.id&&n.kind==='process'&&n.id!==step.id)!;
  const position=knowledgePosition({projectId:'test',view:'company',focus:{kind:'process',id:step.id},stepId:nextStep.id,depth:'detail'});
  const parsed=readScreenLocation(screenURL('/',knowledgeLocation('test',position)).split('?')[1]).location;
  assert.deepEqual(parsed.focus,{kind:'process',id:step.id});assert.equal(parsed.stepId,nextStep.id);
  const resolved=resolveScreenLocation(parsed,graph);assert.equal(resolved.notice,'');assert.equal(resolved.location.workflowId,workflow.id);
  const different=graph.workflows.find(w=>w.id!==workflow.id)!;
  const conflicting=resolveScreenLocation(readScreenLocation(`view=company&processId=${step.id}&workflowId=${different.id}`).location,graph);
  assert.equal(conflicting.location.workflowId,workflow.id);assert.deepEqual(conflicting.location.focus,{kind:'process',id:step.id});assert.ok(conflicting.notice);
});

test('dependency maps and asset reading pages retain the selected layer, kind and page', () => {
  const position=knowledgePosition({projectId:'test',view:'company',focus:{kind:'systems'},relationKind:'dependency',selectedSystemId:system.id});
  const restored=knowledgePosition(readScreenLocation(screenURL('/',knowledgeLocation('test',position)).split('?')[1]).location);
  assert.equal(restored.systemReading?.relationKind,'dependency');
  const location:ScreenLocation={projectId:'test',view:'assets',assetId:system.id,tab:'work',workKind:'indirect',workPage:3,dependencyPage:1};
  const parsed=readScreenLocation(screenURL('/',location).split('?')[1]).location, reading=assetPosition(system.id,parsed.tab,parsed);
  assert.equal(reading.workKind,'indirect');assert.equal(reading.workPage,3);assert.equal(reading.dependencyPage,1);
  assert.equal(shouldPushScreenHistory({...location,workKind:'direct'},location),true);
  assert.equal(shouldPushScreenHistory({...location,workPage:2},location),false);
});

test('screen and subject changes create history, while typing filters keeps the current entry', () => {
  const location:ScreenLocation={projectId:'test',view:'company',focus:{kind:'company'},scope:'current'};
  assert.equal(shouldPushScreenHistory(location,{...location,query:'受注',department:'営業'}),false);
  assert.equal(shouldPushScreenHistory(location,{...location,focus:{kind:'activity',id:activity.id}}),true);
  assert.equal(shouldPushScreenHistory(location,{...location,view:'interviews'}),true);
  assert.equal(shouldPushScreenHistory(location,{...location,tab:'report'}),true);
  assert.ok(readScreenLocation('view=unknown').notice);
  const assets:ScreenLocation={projectId:'test',view:'assets'};
  const selected={...assets,assetId:system.id,scope:'current' as const,tab:'impact'};
  assert.equal(shouldPushScreenHistory(assets,selected),false,'Automatic first selection must not trap the Back button in the same screen.');
  assert.equal(shouldPushScreenHistory(selected,{...selected,tab:'flows'}),true);
  assert.equal(shouldPushScreenHistory(selected,{...selected,assetId:data.id}),true);
  assert.equal(shouldPushScreenHistory(selected,{...selected,workflowId:workflow.id}),true);
  assert.equal(shouldPushScreenHistory(location,{...location,query:'一文字ずつ入力'}),false);
});

test('a link to a saved transfer survives SQLite reload and a second save of a 300-workflow project', async () => {
  const repository=new SqliteBusinessFlowRepository(':memory:');
  await repository.saveProject({projectId:'links',projectName:'独立検証',graph,transcripts:{},updatedAt:'2026-10-06T00:00:00Z'});
  const first=(await repository.loadProject('links'))!, flow=first.graph.dataFlows[0];
  const url=screenURL('/',{projectId:'links',view:'dataflow',flowId:flow.id});
  const parsed=readScreenLocation(url.split('?')[1]).location;
  await repository.saveProject(first);
  const second=(await repository.loadProject('links'))!, opened=resolveScreenLocation(parsed,second.graph);
  assert.equal(opened.notice,'');assert.equal(opened.location.flowId,flow.id);
  assert.deepEqual(second.graph.dataFlows.find(f=>f.id===opened.location.flowId)?.dataIds,flow.dataIds);
  assert.equal(second.graph.workflows.length,303);
});
