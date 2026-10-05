import {readFile,writeFile} from 'node:fs/promises';
import {parse,stringify} from 'yaml';
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
const mode=args.includes('--external')?'external':'cortex',model=args.includes('--model')?arg('--model'):'';
if(!model?.trim())throw new Error('--modelに接続先で利用できるモデル名を指定してください。');
const protocol=args.includes('--protocol')?arg('--protocol'):'openai';
if(!['openai','anthropic'].includes(protocol))throw new Error('--protocolはopenaiまたはanthropicを指定してください。');
const authMode=args.includes('--auth-mode')?arg('--auth-mode'):(mode==='external'&&protocol==='anthropic'?'x-api-key':'bearer');
if(!['bearer','x-api-key'].includes(authMode)||(mode==='cortex'&&authMode!=='bearer'))throw new Error('CortexはBearer認証を使います。外部AIの--auth-modeはbearerまたはx-api-keyを指定してください。');
if(mode==='cortex'&&protocol==='anthropic'&&!/^claude-/.test(model))throw new Error('CortexのMessages APIはClaudeモデルだけに対応します。--modelに利用できるClaudeモデル名を指定してください。');
const manifest=parse(await readFile('app.yml','utf8'));
const changes={AI_PROTOCOL:protocol,AI_MODEL:model,AI_TARGET:'cortex',AI_AUTH_MODE:authMode,AI_ANTHROPIC_VERSION:'2023-06-01'};
if(mode==='external'){
  const endpoint=args.includes('--endpoint')?arg('--endpoint'):'',secret=args.includes('--secret')?arg('--secret'):'',integration=args.includes('--integration')?arg('--integration'):'';
  let url;try{url=new URL(endpoint);}catch{throw new Error('--endpointにAIのAPI接続先を指定してください。');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('AI接続先には認証情報を含まないHTTPSのURLを指定してください。');
  if(!/^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*$/.test(secret)||!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(integration))throw new Error('既存の--secret DB.SCHEMA.NAMEと--integration NAMEを指定してください。');
  changes.AI_BASE_URL=url.href.replace(/\/$/,'');changes.AI_API_KEY_FILE='/secrets/BFL_AI/secret_string';
  manifest.secrets=[...(manifest.secrets??[]).filter(s=>s.name!=='BFL_AI'),{name:'BFL_AI',secret}];
  manifest.external_access_integrations=[...new Set([...(manifest.external_access_integrations??[]),integration])];
}else{manifest.secrets=(manifest.secrets??[]).filter(s=>s.name!=='BFL_AI');if(!manifest.secrets.length)delete manifest.secrets;}
const update=list=>[...(list??[]).filter(v=>!['AI_RUNTIME','AI_MODEL','AI_PROTOCOL','AI_TARGET','AI_BASE_URL','AI_API_KEY_FILE','AI_API_KEY','AI_AUTH_MODE','AI_ANTHROPIC_VERSION'].includes(v.name)),...Object.entries(changes).map(([name,value])=>({name,value}))];
manifest.environment_variables=update(manifest.environment_variables);
for(const target of Object.values(manifest.targets??{}))if(target.environment_variables)target.environment_variables=update(target.environment_variables);
await writeFile('app.yml',stringify(manifest));
console.log(`app.yml: ${mode} model configuration written. No credential values were read. Deployment and model availability have not been tested.`);
