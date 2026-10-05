import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,access,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';

const packageOnly=process.argv.includes('--package-only');
const testAI=process.argv.includes('--ai');
if(packageOnly&&testAI)throw new Error('--aiはAIを接続した実際の配置先で実行してください。');
const dist=process.env.BFL_NEXT_DIST_DIR||'.next';
let server,temporary;
const origin=packageOnly?`http://127.0.0.1:${process.env.BFL_RUNTIME_TEST_PORT||'3118'}`:process.env.BFL_RUNTIME_URL;
if(!origin)throw new Error('BFL_RUNTIME_URLに検証するアプリのURLを指定してください。');
const url=new URL(origin);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('検証先のURLを確認してください。');
const headers=process.env.BFL_RUNTIME_COOKIE?{Cookie:process.env.BFL_RUNTIME_COOKIE}:{};
async function request(path,options={}){
  return fetch(new URL(path,url),{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(90_000)});
}
async function api(path,method='GET',body){
  const response=await request(path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(response.ok,`${method} ${path.split('?')[0]} returned ${response.status}`);
  return response.json();
}
async function stopServer(){
  if(!server?.pid)return;
  if(process.platform==='win32')await new Promise(r=>{const killer=spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('exit',r);killer.once('error',r);});
  else {server.kill('SIGTERM');await new Promise(r=>{server.once('exit',r);setTimeout(()=>{server.kill('SIGKILL');r();},3000).unref();});}
  server=undefined;
}
async function waitForServer(){
  const deadline=Date.now()+30_000;
  while(true){
    if(server.exitCode!==null)throw new Error('The packaged server failed to start.');
    try {if((await request('/')).ok)break;}catch{}
    if(Date.now()>deadline)throw new Error('The packaged server did not become ready.');
    await new Promise(r=>setTimeout(r,300));
  }
}
try {
  if(packageOnly){
    for(const path of ['server.js','node_modules/snowflake-sdk/dist/index.js','node_modules/pdfjs-dist/legacy/build/pdf.mjs','node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf','node_modules/pdfjs-dist/cmaps/UniJIS-UTF16-H.bcmap','public/examples/manufacturing-audit.pdf'])await access(join(dist,'standalone',path));
    server=spawn(process.execPath,['scripts/start-app-runtime.mjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,BUSINESS_FLOW_STORAGE:'snowflake',SNOWFLAKE_HOST:'unconfigured.snowflakecomputing.com',SNOWFLAKE_DATABASE:'BFL_TEST',SNOWFLAKE_SCHEMA:'APP',SNOWFLAKE_WAREHOUSE:'COMPUTE_WH',SNOWFLAKE_PAT:'package-test-not-a-credential',SNOWFLAKE_STORAGE_AUTH:'pat',SNOWFLAKE_TOKEN_FILE:'',AI_RUNTIME:'',AI_MODEL:'',PORT:url.port,HOSTNAME:'127.0.0.1'}});
    await waitForServer();
  }
  const page=await request('/'),html=await page.text();assert.equal(page.status,200);assert.match(html,/BusinessFlowLens/);
  const assets=[...html.matchAll(/(?:src|href)="([^" ]+\/_next\/static\/[^" ]+|\/_next\/static\/[^" ]+)"/g)].map(m=>m[1]);
  assert.ok(assets.length>0,'The page must reference its packaged CSS/JavaScript.');
  for(const asset of new Set(assets))assert.equal((await request(asset)).status,200,`Missing packaged asset: ${asset}`);
  const sample=await request('/examples/manufacturing-audit.pdf');assert.equal(sample.status,200);assert.ok((await sample.arrayBuffer()).byteLength>100);
  if(packageOnly){
    // CI verifies the actual packaged PDF/native renderer with an isolated SQLite file, without Snowflake credentials.
    await stopServer();temporary=await mkdtemp(join(tmpdir(),'bfl-runtime-package-'));
    server=spawn(process.execPath,[resolve(dist,'standalone','server.js')],{windowsHide:true,stdio:'inherit',env:{...process.env,BUSINESS_FLOW_STORAGE:'sqlite',BUSINESS_FLOW_SQLITE_PATH:join(temporary,'package.sqlite'),AI_RUNTIME:'',AI_MODEL:'',PORT:url.port,HOSTNAME:'127.0.0.1'}});
    await waitForServer();
  }
  {
    const health=await api('/api/health');assert.equal(health.ready,true);assert.equal(health.storage,packageOnly?'sqlite':'snowflake');
    if(testAI){assert.equal(health.ai.configured,true,'AI must be configured; the simple extractor cannot pass an AI test.');assert.equal(health.ai.runtime,'api','This test verifies the cloud API transport rather than local Codex login.');}
    const projectId=`runtime-http-${packageOnly?'package':health.tableKind}-${randomUUID()}`,workflow={id:'credit-check',name:'出荷を保留する',scenario:'current'},source='営業がSAPで与信を確認する。超過時は出荷を保留し、Teamsで経理へ解除を依頼する。解除の承認者は未確認。';
    const graph={workflows:[workflow],nodes:[],edges:[],dataFlows:[]};
    await api('/api/project','PUT',{projectId,projectName:'Runtime独立検証',graph,transcripts:{[workflow.id]:source}});
    const loaded=await api(`/api/project?projectId=${encodeURIComponent(projectId)}`);assert.equal(loaded.storage,health.storage);assert.equal(loaded.project.transcripts[workflow.id],source);
    if(testAI){
      const extracted=await api('/api/extract','POST',{workflow,graph:loaded.project.graph,interview:source});
      assert.doesNotMatch(extracted.provider,/local-demo/);assert.ok(extracted.review.steps.some(s=>s.meaning?.halt||s.executionContext?.exception?.includes('保留')),'The credit hold must remain visible.');
      assert.ok(extracted.review.questions.length>0,'The unknown release approver must remain a question.');
    }
    // Persistence and rendering are verified without depending on AI extraction quality.
    const review={summary:source,trigger:'与信を確認する',outcome:null,steps:[{stepKey:'hold',name:'出荷を保留する',order:1,actor:'営業',action:'超過時は出荷を保留する',executionMode:'manual',executingSystem:null,certainty:'explicit',evidence:'超過時は出荷を保留',systems:[{name:'SAP',interaction:'view',evidence:'SAPで与信を確認'}],data:[],meaning:{purpose:'',basis:'与信の超過',result:'出荷保留',next:'経理へ解除を依頼する',condition:'与信超過時',halt:true,certainty:'confirmed',evidence:'超過時は出荷を保留'}}],transitions:[],dataFlows:[],questions:[{question:'解除の承認者は誰ですか？',reason:'元の話で未確認',target:'owner'}],warnings:[]};
    const applied=await api('/api/apply','POST',{projectId,workflow,graph:loaded.project.graph,review,transcripts:loaded.project.transcripts,sourceNotes:source});
    assert.ok(applied.graph.nodes.some(n=>n.kind==='process'&&n.meaning?.halt));
    const history=await api(`/api/workflow-revisions?projectId=${encodeURIComponent(projectId)}&workflowId=${workflow.id}`);assert.equal(history.revisions.length,1);
    const revision=await api(`/api/workflow-revisions?projectId=${encodeURIComponent(projectId)}&revisionId=${history.revisions[0].id}`);assert.equal(revision.revision.sourceNotes,source);assert.ok(revision.revision.review.questions.length>0);
    const files=[];
    for(const name of ['vendor-inspection.png','manufacturing-audit.pdf']){
      const bytes=await readFile(join('public/examples',name)),form=new FormData();form.set('projectId',projectId);form.set('stage','1');form.set('file',new File([bytes],name));
      const upload=await request('/api/source-document',{method:'POST',body:form});assert.equal(upload.status,200);const {document}=await upload.json();assert.equal(document.rendering.status,'pending');
      const base=`/api/source-document?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(document.id)}`;
      const original=await request(base+'&original=1');assert.equal(original.status,200);assert.equal(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'),document.sha256);
      const prepared=await api('/api/source-document/prepare','POST',{projectId,documentId:document.id});assert.equal(prepared.document.rendering.status,'ready');assert.ok(prepared.document.units.length>0);assert.ok(prepared.document.units.every(u=>u.image));
      for(const unit of prepared.document.units){const image=await request(base+'&image='+encodeURIComponent(unit.id));assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/jpeg');assert.ok((await image.arrayBuffer()).byteLength>100);}
      if(testAI){const analyzed=await api('/api/source-document/analyze','POST',{projectId,documentId:document.id});assert.equal(analyzed.document.analysis.method,'ai');assert.equal(analyzed.document.analysis.model,health.ai.model);assert.ok(analyzed.document.units.some(u=>u.visualReading?.method==='ai'),'Rendered page images must actually be read by AI.');assert.ok(analyzed.document.workItems.length>0);}
      await api('/api/source-document/state','POST',{projectId,documentId:document.id,state:'withdrawn'});
      const rejected=await request('/api/source-document/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,documentId:document.id})});assert.equal(rejected.status,409);
      assert.equal((await request(base+'&original=1')).status,200,'Withdrawing interpretation must retain the original.');
      await api('/api/source-document/state','POST',{projectId,documentId:document.id,state:'active'});files.push({id:document.id,name,sha256:document.sha256});
    }
    const final=await api(`/api/project?projectId=${encodeURIComponent(projectId)}`);assert.ok(final.project.graph.nodes.some(n=>n.kind==='process'));
    const report=await request(`/api/report?projectId=${encodeURIComponent(projectId)}&scope=current`);assert.equal(report.status,200);assert.match(await report.text(),/出荷を保留する/);
    await mkdir('.data/snowflake',{recursive:true});await writeFile(`.data/snowflake/${packageOnly?'package':'runtime'}-http-results.json`,JSON.stringify({completedAt:new Date().toISOString(),projectId,storage:health.storage,tableKind:health.tableKind,aiConfiguration:health.ai,aiExtractionTested:testAI,aiResolutionInvoked:health.ai.configured,files},null,2));
    console.log(packageOnly?'Packaged entry point, CSS, JavaScript, public examples, PDF-to-image, image upload, revisions and persistence passed using isolated SQLite. Snowflake and AI were not contacted.':`Snowflake ${health.tableKind} HTTP checks passed. Independent project: ${projectId}. AI extraction quality was not part of this storage test.`);
  }
} finally {
  await stopServer();
  if(temporary){const root=resolve(tmpdir()),target=resolve(temporary);assert.ok(target.startsWith(root+ (process.platform==='win32'?'\\':'/'))&&target.slice(root.length+1).startsWith('bfl-runtime-package-'));await rm(target,{recursive:true,force:true});}
}
