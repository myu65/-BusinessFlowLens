import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAIBaseURL, resolveAIToken} from '../lib/ai/credentials';

test('App Runtime AI reads the rotating service token only for its own Snowflake AI endpoint',()=>{
  const env={SNOWFLAKE_HOST:'account.snowflakecomputing.com',AI_MODEL:'configured-model'},reads:string[]=[];
  let token='service-first';
  const files={exists:()=>true,read:(path:string)=>{reads.push(path);return token;}};
  assert.equal(resolveAIToken(resolveAIBaseURL(env),env,files),'service-first');
  token='service-rotated';assert.equal(resolveAIToken(resolveAIBaseURL(env),env,files),'service-rotated');
  assert.deepEqual(reads,['/snowflake/session/token','/snowflake/session/token']);
  for(const baseURL of ['https://external.example/v1','https://account.snowflakecomputing.com@external.example/v1','http://account.snowflakecomputing.com/api/v2/cortex/v1','https://account.snowflakecomputing.com:8443/api/v2/cortex/v1','https://account.snowflakecomputing.com/other']){
    assert.equal(resolveAIToken(baseURL,env,files),undefined);
  }
  assert.equal(reads.length,2,'No external destination should read or receive the service credential.');
  assert.equal(resolveAIToken('https://account.snowflakecomputing.com/api/v2/cortex',env,files),'service-rotated');
  assert.equal(resolveAIToken('https://account.snowflakecomputing.com/api/v2/cortex/v1?redirect=external',env,files),undefined);
  assert.equal(resolveAIToken('https://account.snowflakecomputing.com/api/v2/cortex/inference:complete',env,files),undefined);
});

test('an external AI secret is reread after rotation; a missing mounted secret is not replaced with a stale environment key',()=>{
  const env={SNOWFLAKE_HOST:'account.snowflakecomputing.com',AI_API_KEY_FILE:'/secrets/AI_KEY/secret_string',AI_API_KEY:'stale-key'};
  let token='external-first';const files={exists:()=>true,read:(path:string)=>{assert.equal(path,env.AI_API_KEY_FILE);return token;}};
  assert.equal(resolveAIToken('https://external.example/v1',env,files),'external-first');
  token='external-rotated';assert.equal(resolveAIToken('https://external.example/v1',env,files),'external-rotated');
  assert.equal(resolveAIToken('https://external.example/v1',env,{exists:()=>true,read:()=>{throw new Error('secret absent');}}),undefined);
});
test('an App Runtime internal Snowflake endpoint honors only its platform-provided protocol and port',()=>{
  const env={SNOWFLAKE_HOST:'snowflake.internal',SNOWFLAKE_PROTOCOL:'http',SNOWFLAKE_PORT:'8081'},files={exists:()=>true,read:()=> 'runtime-token'};
  const url=resolveAIBaseURL(env,files);assert.equal(url,'http://snowflake.internal:8081/api/v2/cortex/v1');assert.equal(resolveAIToken(url,env,files),'runtime-token');
  assert.equal(resolveAIToken('http://snowflake.internal:8082/api/v2/cortex/v1',env,files),undefined);
  assert.equal(resolveAIToken('http://another.internal:8081/api/v2/cortex/v1',env,files),undefined);
});
