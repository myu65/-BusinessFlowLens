import test from 'node:test';
import assert from 'node:assert/strict';
import {completeDocumentAnalysis} from '../scripts/document-analysis.mjs';

test('runtime AI verification continues from page batches through final work reconciliation',async()=>{
  const responses=[{progress:{stage:'pages',read:3,total:7}},{progress:{stage:'pages',read:6,total:7}},{progress:{stage:'pages',read:7,total:7}},{document:{analysis:{method:'ai'},workItems:[{title:'確認する'}]}}];
  let calls=0;
  const result=await completeDocumentAnalysis(async()=>responses[calls++],7);
  assert.equal(calls,4);assert.deepEqual(result,responses[3]);
});
test('runtime AI verification rejects stalled progress and a changed page count',async()=>{
  for(const progress of [{stage:'pages',read:0,total:3},{stage:'pages',read:3,total:4},{stage:'pages',read:4,total:3}])
    await assert.rejects(()=>completeDocumentAnalysis(async()=>({progress}),3),/読取りが進んでいません/);
  let calls=0;
  await assert.rejects(()=>completeDocumentAnalysis(async()=>{calls++;return {progress:{stage:'pages',read:1,total:3}};},3),/読取りが進んでいません/);
  assert.equal(calls,2);
});
