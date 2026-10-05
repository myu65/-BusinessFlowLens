import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {writeFile,rm} from 'node:fs/promises';
import type {Connection} from 'snowflake-sdk';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {parse} from 'yaml';
import {SnowflakeClient,snowflakeStorageConfig,snowflakeIdentifier,snowflakeStorageError} from '../lib/storage/snowflake-client';
import {snowflakeSetupStatements,snowflakeObjects} from '../lib/storage/snowflake-schema';
import {SqliteBusinessFlowRepository} from '../lib/storage/sqlite';
import {storageContract} from './storage-contract';
const env={SNOWFLAKE_HOST:'ACCOUNT.snowflakecomputing.com',SNOWFLAKE_USER:'tester',SNOWFLAKE_PAT:'fake-test-token',SNOWFLAKE_DATABASE:'BFL_TEST',SNOWFLAKE_SCHEMA:'APP',SNOWFLAKE_WAREHOUSE:'COMPUTE_WH'};
test('Snowflake configuration permits the requested host and rejects arbitrary credential destinations and SQL identifiers',()=>{
  const config=snowflakeStorageConfig(env);assert.equal(config.host,'account.snowflakecomputing.com');assert.equal(config.tableKind,'standard');
  for(const host of ['https://account.snowflakecomputing.com','evil.example','account.snowflakecomputing.com@evil.example','account.snowflakecomputing.com/path'])assert.throws(()=>snowflakeStorageConfig({...env,SNOWFLAKE_HOST:host}),/ホスト/);
  for(const name of ['A;DROP TABLE X','A.B','"A"','A\nB'])assert.throws(()=>snowflakeIdentifier(name),/スキーマ/);
  assert.throws(()=>snowflakeStorageConfig({...env,SNOWFLAKE_TABLE_KIND:'automatic'}),/standard/);
});
test('mounted OAuth credentials override a PAT and can use a different storage namespace',()=>{
  const config=snowflakeStorageConfig({...env,SNOWFLAKE_STORAGE_AUTH:'oauth',SNOWFLAKE_TOKEN_FILE:'/mounted/token',BUSINESS_FLOW_SNOWFLAKE_DATABASE:'BFL_DATA',BUSINESS_FLOW_SNOWFLAKE_SCHEMA:'GRAPH'});
  assert.equal(config.authenticator,'OAUTH');assert.equal(config.token,undefined);assert.equal(config.tokenFilePath,'/mounted/token');assert.equal(config.database,'BFL_DATA');assert.equal(config.schema,'GRAPH');
});
test('a mounted App Runtime service uses built-in account, internal endpoint and port; local PAT connections keep HTTPS',()=>{
  const cfg=snowflakeStorageConfig({...env,SNOWFLAKE_ACCOUNT:'ACCOUNT_LOCATOR',SNOWFLAKE_HOST:'snowflake.internal',SNOWFLAKE_PROTOCOL:'http',SNOWFLAKE_PORT:'8081',SNOWFLAKE_ROLE:'ACCOUNTADMIN'},true);
  assert.equal(cfg.account,'ACCOUNT_LOCATOR');assert.equal(cfg.accessUrl,'http://snowflake.internal:8081');assert.equal(cfg.authenticator,'OAUTH');assert.equal(cfg.tokenFilePath,'/snowflake/session/token');assert.equal(cfg.role,undefined);assert.equal(cfg.user,undefined);assert.equal(cfg.token,undefined);
  assert.equal(snowflakeStorageConfig({...env,SNOWFLAKE_PROTOCOL:'http',SNOWFLAKE_PORT:'8081'},false).accessUrl,'https://account.snowflakecomputing.com');
});
test('standard and hybrid schema have separate names, actual constraints, evidence stages and traversable objects',()=>{
  for(const tableKind of ['standard','hybrid'] as const){const cfg={...snowflakeStorageConfig(env),tableKind},sql=snowflakeSetupStatements(cfg);assert.equal(sql.filter(s=>s.startsWith(tableKind==='hybrid'?'CREATE HYBRID TABLE':'CREATE TABLE')).length,4);assert.ok(sql.some(s=>/PRIMARY KEY\(PROJECT_ID,DOCUMENT_ID\)/.test(s)));assert.ok(sql.some(s=>/UNIQUE\(PROJECT_ID,WORKFLOW_ID,REVISION_NUMBER\)/.test(s)));assert.ok(sql.some(s=>s.includes('CREATE STAGE')));for(const name of ['WORKFLOWS','NODES','EDGES','CAPABILITIES','HANDOFFS','SYSTEM_DEPENDENCIES','SYSTEM_USAGE'])assert.ok(sql.some(s=>s.includes(snowflakeObjects(cfg)(name))));assert.ok(sql.every(s=>!s.includes(tableKind==='hybrid'?'BFL_ST_':'BFL_HT_')));}
});
test('Snowflake errors never forward driver credentials, SQL, notes, or signed object URLs',()=>{
  const error=snowflakeStorageError({code:391404,message:'token=secret SQL=SELECT private_notes url=signed'});assert.match(error.message,/Hybrid Tables/);assert.doesNotMatch(error.message,/secret|private_notes|signed/);assert.equal(error.code,'391404');
  assert.match(snowflakeStorageError({code:390432}).message,/ネットワーク/);
});

test('sessions serialize transactions, reread OAuth rotation and discard a failed session before the next operation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'bfl-token-contract-')),path=join(dir,'token');
  const opened:string[]=[],events:string[]=[];
  const client=new SnowflakeClient(snowflakeStorageConfig({...env,SNOWFLAKE_STORAGE_AUTH:'oauth',SNOWFLAKE_TOKEN_FILE:path}),async token=>{
    opened.push(token);const id=opened.length;
    return {execute:({sqlText,complete}:any)=>{events.push(`${id}:${sqlText}`);complete(undefined,{},[{OK:true}]);},destroy:(done:()=>void)=>{events.push(`${id}:close`);done();}} as unknown as Connection;
  });
  try {
    await writeFile(path,'first-service-token');
    let unlock!:()=>void,started!:()=>void;
    const startedPromise=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>unlock=r);
    const transaction=client.withSession(async s=>{await s.query('BEGIN');started();await gate;await s.query('COMMIT');});
    await startedPromise;
    const laterRead=client.withSession(s=>s.query('READ'));
    assert.deepEqual(events,['1:BEGIN']);unlock();await Promise.all([transaction,laterRead]);
    assert.deepEqual(events,['1:BEGIN','1:COMMIT','1:READ']);
    await writeFile(path,'rotated-service-token');await client.withSession(s=>s.query('AFTER ROTATION'));
    assert.deepEqual(opened,['first-service-token','rotated-service-token']);assert.ok(events.indexOf('1:close')<events.indexOf('2:AFTER ROTATION'));
    await assert.rejects(()=>client.withSession(async()=>{throw new Error('failed operation, possibly failed rollback');}),/failed operation/);
    await client.withSession(s=>s.query('NEW SESSION'));
    assert.equal(opened.length,3);assert.ok(events.indexOf('2:close')<events.indexOf('3:NEW SESSION'));
  } finally {await client.close();const absolute=resolve(dir),base=resolve(tmpdir());assert.ok(absolute.startsWith(base+sep)&&absolute.slice(base.length+1).startsWith('bfl-token-contract-'));await rm(absolute,{recursive:true,force:true});}
});
test('the shared contract also holds for SQLite so the new adapter does not redefine lifecycle, source or revision semantics',async t=>{
  const file=join(mkdtempSync(join(tmpdir(),'bfl-storage-contract-')),'graph.sqlite');await storageContract(t,new SqliteBusinessFlowRepository(file),new SqliteBusinessFlowRepository(file),'sqlite-contract');
});
test('App Runtime manifest excludes local credentials and data, packages standalone assets, and configures both storage targets',()=>{
  const manifest=parse(readFileSync('app.yml','utf8'));assert.equal(manifest.version,2);for(const excluded of ['.env*','.data','.git','node_modules','*.sqlite*'])assert.ok(manifest.ignore.includes(excluded));
  assert.deepEqual(manifest.run.command,['node','scripts/start-app-runtime.mjs']);assert.deepEqual(manifest.build.commands,[['npm','run','build:app-runtime']]);
  for(const target of ['standard','hybrid']){const merged={...manifest,...manifest.targets[target]},vars=Object.fromEntries(merged.environment_variables.map((v:{name:string;value:string})=>[v.name,v.value]));assert.equal(vars.BUSINESS_FLOW_STORAGE,'snowflake');assert.equal(vars.SNOWFLAKE_TABLE_KIND,target);assert.equal(vars.SNOWFLAKE_TOKEN_FILE,'/snowflake/session/token');assert.ok(!vars.SNOWFLAKE_PAT&&!vars.AI_API_KEY&&!vars.AI_RUNTIME);}
});
