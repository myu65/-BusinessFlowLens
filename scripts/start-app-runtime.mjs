import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
if(process.env.BUSINESS_FLOW_STORAGE!=='snowflake')throw new Error('App Runtimeの保存先はBUSINESS_FLOW_STORAGE=snowflakeに設定してください。');
if(process.env.AI_RUNTIME==='codex')throw new Error('AI_RUNTIME=codexはローカル専用です。App RuntimeではAIのAPI接続を設定してください。');
process.env.PORT ||= '8080';
process.env.HOSTNAME ||= '0.0.0.0';
const dist=process.env.BFL_NEXT_DIST_DIR||'.next';
await import(pathToFileURL(resolve(dist,'standalone','server.js')).href);
