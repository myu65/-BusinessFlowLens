import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createChemicalCompany} from '../lib/chemical-company';
import {buildWorkflowReviewFromGraph,type LensGraph} from '../lib/graph';
import {normalizeSnapshotGraph} from '../lib/storage/normalize';
import {ProjectChangedError,type BusinessFlowRepository,type ProjectSnapshot} from '../lib/storage/repository';
import type {SourceDocument,SourceImage} from '../lib/source-document';

export async function storageContract(t:TestContext,first:BusinessFlowRepository,second:BusinessFlowRepository,prefix:string,large=false){
  const projectId=`${prefix}-${randomUUID()}`, graph:LensGraph=large?createChemicalCompany():{workflows:[{id:'受注-1',familyId:'受注-1',name:'与信を確認する',scenario:'current',trigger:null,outcome:null,reviewContext:{summary:'与信超過なら保留。解除方法は未確認。',trigger:null,outcome:null,warnings:[],questions:[{question:'誰が解除しますか？',reason:'資料にない',target:'owner'}]}}],nodes:[],edges:[],dataFlows:[]};
  const snapshot:ProjectSnapshot={projectId,projectName:'独立したSnowflake検証会社',graph,transcripts:{'受注-1':'与信超過なら保留。解除方法は未確認。'},updatedAt:'2026-10-06T01:00:00.000Z'};
  await t.test('project and uncertain source facts round trip without changing logical identity',async()=>{
    assert.equal(await first.loadProject(projectId),null);
    await first.saveProject(snapshot);
    const loaded=await second.loadProject(projectId);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded?.graph)),JSON.parse(JSON.stringify(normalizeSnapshotGraph(graph))));
    assert.equal(loaded?.projectName,snapshot.projectName);
    assert.equal(loaded?.transcripts['受注-1'],snapshot.transcripts['受注-1']);
    assert.equal(await first.loadProject(projectId+'-other'),null);
  });
  await t.test('two sessions updating the same saved version produce one winner and one conflict',async()=>{
    const a={...snapshot,projectName:'営業部による訂正',updatedAt:'2026-10-06T01:00:01.000Z'},b={...snapshot,projectName:'品質部による訂正',updatedAt:'2026-10-06T01:00:02.000Z'};
    const results=await Promise.allSettled([first.saveProject(a,snapshot.updatedAt),second.saveProject(b,snapshot.updatedAt)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const failed=results.find(r=>r.status==='rejected');assert.ok(failed?.status==='rejected'&&failed.reason instanceof ProjectChangedError);
    const loaded=await first.loadProject(projectId);assert.ok(loaded?.projectName===a.projectName||loaded?.projectName===b.projectName);
    assert.equal(loaded?.updatedAt,loaded?.projectName===a.projectName?a.updatedAt:b.updatedAt);
  });
  await t.test('concurrent first saves do not create duplicate project IDs',async()=>{
    const id=projectId+'-new';await Promise.all([first.saveProject({...snapshot,projectId:id}),second.saveProject({...snapshot,projectId:id,projectName:'同じ会社'})]);
    assert.ok(await first.loadProject(id));assert.ok(await second.loadProject(id));
  });
  const png=await sharp({create:{width:120,height:80,channels:3,background:'#ffffff'}}).png().toBuffer();
  const jpeg=await sharp(png).jpeg().toBuffer();
  const doc:SourceDocument={id:'元資料-1',name:"与信確認 '原本'.png",format:'png',sha256:createHash('sha256').update(png).digest('hex'),byteSize:png.length,createdAt:new Date().toISOString(),warnings:[],units:[{id:'page-1',page:1,location:'1ページ',text:'与信超過 → 保留。解除先は未確認。',image:{width:120,height:80,mimeType:'image/jpeg'}}]};
  const image:SourceImage={unitId:'page-1',bytes:jpeg,width:120,height:80,mimeType:'image/jpeg'};
  await t.test('original document and page image round trip and stay isolated by project',async()=>{
    await first.saveSourceDocument(projectId,doc,png,[image]);
    const original=await second.getSourceDocument(projectId,doc.id);assert.deepEqual(original?.document,doc);assert.deepEqual(Buffer.from(original!.bytes),png);
    const storedImage=await second.getSourceImage(projectId,doc.id,image.unitId);assert.deepEqual(Buffer.from(storedImage!.bytes),jpeg);assert.equal(storedImage?.width,120);
    assert.equal(await second.getSourceDocument(projectId+'-other',doc.id),null);assert.equal(await second.getSourceImage(projectId+'-other',doc.id,image.unitId),null);
    assert.equal((await first.listSourceDocuments(projectId))[0].name,doc.name);assert.equal((await second.findSourceDocument(projectId,doc.sha256))?.id,doc.id);
  });
  await t.test('withdrawal rejects a late AI result and reactivation requires the new generation',async()=>{
    const withdrawn=await second.setSourceDocumentState(projectId,doc.id,'withdrawn');assert.equal(withdrawn?.lifecycle?.generation,1);
    await assert.rejects(()=>first.saveSourceDocument(projectId,{...doc,warnings:['遅いAI結果']},png),/取り消/);
    assert.equal((await first.getSourceDocument(projectId,doc.id))?.document.lifecycle?.state,'withdrawn');
    const active=await first.setSourceDocumentState(projectId,doc.id,'active');assert.equal(active?.lifecycle?.generation,2);
    await assert.rejects(()=>second.saveSourceDocument(projectId,doc,png),/取り消/);
    const updated={...active!,warnings:['再開後の読取り・推定は要確認']};await second.saveSourceDocument(projectId,updated,png);assert.deepEqual((await first.getSourceDocument(projectId,doc.id))?.document,updated);
    assert.deepEqual(Buffer.from((await second.getSourceDocument(projectId,doc.id))!.bytes),png);
  });
  await t.test('revisions have distinct IDs and monotonic numbers across sessions; evidence and human corrections remain',async()=>{
    const review=buildWorkflowReviewFromGraph(graph,graph.workflows[0].id);
    review.summary='未確認の解除先を残す';const followUpAnswers=[{question:'担当は？',answer:'品質課長です。',kind:'answer' as const}];
    review.questionReviews=[{id:'owner-evidence',question:{question:'担当は？',reason:'未記載',target:'owner'},state:'resolved',evidence:'品質課長です。',reviewedAt:'2026-10-06T01:00:00Z',origin:'human'}];
    const revision={projectId,workflowId:graph.workflows[0].id,workflowName:graph.workflows[0].name,sourceNotes:'与信超過なら保留。解除方法は未確認。',followUpAnswers,review,updatedBy:'テスト利用者',createdAt:new Date().toISOString()};
    const saved=await Promise.all([first.appendWorkflowRevision(revision),second.appendWorkflowRevision({...revision,scenario:'future',basedOnWorkflowId:revision.workflowId})]);
    assert.notEqual(saved[0].id,saved[1].id);assert.deepEqual(saved.map(r=>r.revisionNumber).sort(),[1,2]);
    const revisions=await second.listWorkflowRevisions(projectId,revision.workflowId);assert.deepEqual(revisions.map(r=>r.revisionNumber),[2,1]);
    for(const item of saved){const restored=await first.getWorkflowRevision(projectId,item.id);assert.deepEqual(restored?.review,JSON.parse(JSON.stringify(review)));assert.equal(restored?.sourceNotes,revision.sourceNotes);assert.equal(await first.getWorkflowRevision(projectId+'-other',item.id),null);}
  });
  return {projectId,graph:normalizeSnapshotGraph(graph),document:doc,image};
}
