import test from 'node:test';
import assert from 'node:assert/strict';
import {SnowflakeBusinessFlowRepository} from '../lib/storage/snowflake';
import {snowflakeStorageConfig,SnowflakeStorageError} from '../lib/storage/snowflake-client';
import {snowflakeObjects} from '../lib/storage/snowflake-schema';
import {storageContract} from './storage-contract';

test('real Snowflake repository contract and virtual graph',async t=>{
  const config=snowflakeStorageConfig(),first=new SnowflakeBusinessFlowRepository(config),second=new SnowflakeBusinessFlowRepository(config);
  try{
    try{await first.setup();}catch(error){if(config.tableKind==='hybrid'&&error instanceof SnowflakeStorageError&&error.code==='391404'&&process.env.BFL_ALLOW_UNAVAILABLE_HYBRID==='1'){t.skip('Hybrid Tables are unavailable in this trial account (391404). No hybrid contract was executed.');return;}throw error;}
    const result=await storageContract(t,first,second,`snowflake-${config.tableKind}`,true),o=snowflakeObjects(config);
    await t.test('withdrawal racing with a page upload cannot publish a late interpretation or replace the original',async()=>{
      const active=(await first.getSourceDocument(result.projectId,result.document.id))!;
      const normal=first.client.withSession.bind(first.client);
      let started!:()=>void,release!:()=>void;
      const reached=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
      first.client.withSession=work=>normal(s=>work({query:async(sql,binds)=>{if(sql.startsWith('PUT ')){started();await gate;}return s.query(sql,binds);}}));
      try{
        const pending=first.saveSourceDocument(result.projectId,{...active.document,warnings:['反映してはいけない遅い解釈']},active.bytes,[result.image]);
        await reached;await second.setSourceDocumentState(result.projectId,result.document.id,'withdrawn');release();
        await assert.rejects(()=>pending,/取り消/);
      }finally{release();first.client.withSession=normal;}
      const retained=(await second.getSourceDocument(result.projectId,result.document.id))!;
      assert.equal(retained.document.lifecycle?.state,'withdrawn');assert.deepEqual(retained.document.warnings,active.document.warnings);assert.deepEqual(Buffer.from(retained.bytes),Buffer.from(active.bytes));
      const reopened=await first.setSourceDocumentState(result.projectId,result.document.id,'active');
      await assert.rejects(()=>second.saveSourceDocument(result.projectId,{...reopened!,sha256:'0'.repeat(64)},active.bytes),/一致/);
      assert.equal((await first.getSourceDocument(result.projectId,result.document.id))!.document.sha256,active.document.sha256);
    });
    await t.test('303-workflow fixture is queryable by stable IDs, scenario and concrete System usage',async()=>{
      const rows=await first.client.withSession(session=>session.query(`SELECT WORKFLOW_ID,SCENARIO FROM ${o('WORKFLOWS')} WHERE PROJECT_ID=?`,[result.projectId]));assert.equal(rows.length,303);
      assert.equal(rows.filter(r=>r.SCENARIO==='current').length,result.graph.workflows.filter(w=>(w.scenario??'current')==='current').length);
      const system=result.graph.nodes.find(n=>n.kind==='system'&&n.label==='Snowflake DWH');
      assert.ok(system,'The fixture must contain its shared Snowflake DWH system.');
      const actual=new Set(result.graph.edges.filter(e=>['uses','executes'].includes(e.relation)&&(e.source===system.id||e.target===system.id)).map(e=>result.graph.nodes.find(n=>n.kind==='process'&&(n.id===e.source||n.id===e.target))?.workflowId).filter(Boolean));
      const usage=await first.client.withSession(session=>session.query(`SELECT DISTINCT WORKFLOW_ID FROM ${o('SYSTEM_USAGE')} WHERE PROJECT_ID=? AND SYSTEM_ID=?`,[result.projectId,system.id]));assert.deepEqual(new Set(usage.map(r=>r.WORKFLOW_ID)),actual);
      const counts=await first.client.withSession(session=>session.query(`SELECT (SELECT COUNT(*) FROM ${o('NODES')} WHERE PROJECT_ID=?) AS NODES,(SELECT COUNT(*) FROM ${o('EDGES')} WHERE PROJECT_ID=?) AS EDGES,(SELECT COUNT(*) FROM ${o('CAPABILITIES')} WHERE PROJECT_ID=?) AS CAPABILITIES`,[result.projectId,result.projectId,result.projectId]));assert.equal(Number(counts[0].NODES),result.graph.nodes.length);assert.equal(Number(counts[0].EDGES),result.graph.edges.length);assert.equal(Number(counts[0].CAPABILITIES),result.graph.knowledge?.activities.reduce((n,a)=>n+a.capabilities.length,0));
      const related=await first.client.withSession(session=>session.query(`SELECT (SELECT COUNT(*) FROM ${o('MATERIAL_HANDOFFS')} WHERE PROJECT_ID=?) AS MATERIALS,(SELECT COUNT(*) FROM ${o('SYSTEM_DEPENDENCIES')} WHERE PROJECT_ID=?) AS DEPENDENCIES,(SELECT COUNT(*) FROM ${o('SYSTEM_CATEGORIES')} WHERE PROJECT_ID=?) AS CATEGORIES,(SELECT COUNT(*) FROM ${o('SOURCE_UNITS')} WHERE PROJECT_ID=?) AS UNITS`,[result.projectId,result.projectId,result.projectId,result.projectId]));
      assert.equal(Number(related[0].MATERIALS),result.graph.workflows.reduce((n,w)=>n+(w.landscape?.materialHandoffs.length??0),0));
      assert.equal(Number(related[0].DEPENDENCIES),result.graph.knowledge!.systems.reduce((n,s)=>n+s.dependsOn.length,0));assert.equal(Number(related[0].CATEGORIES),result.graph.knowledge!.categories.length);assert.equal(Number(related[0].UNITS),result.document.units.length);
    });
    t.diagnostic(`Independent project: ${result.projectId}. Saved fixture, raw source and revisions remain available for inspection.`);
  }finally{await Promise.all([first.close(),second.close()]);}
});
