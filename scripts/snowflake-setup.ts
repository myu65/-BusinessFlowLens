import { SnowflakeBusinessFlowRepository } from '../lib/storage/snowflake';
import { snowflakeStorageConfig, snowflakeIdentifier } from '../lib/storage/snowflake-client';
import {snowflakeSetupStatements,snowflakeDataGrants} from '../lib/storage/snowflake-schema';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';

async function run() {
  const args=process.argv.slice(2),env={...process.env};
  if(args.includes('--target') || args.includes('--print-sql')){
    const manifest=parse(readFileSync('app.yml','utf8')),target=args.includes('--target')?args[args.indexOf('--target')+1]:manifest.default_target;
    if(!target || !manifest.targets?.[target])throw new Error('app.ymlにあるtargetを指定してください。');
    const resolved={...manifest,...manifest.targets[target]},vars=Object.fromEntries(resolved.environment_variables.map((v:{name:string;value:string})=>[v.name,v.value]));
    env.BUSINESS_FLOW_SNOWFLAKE_DATABASE=resolved.database;env.BUSINESS_FLOW_SNOWFLAKE_SCHEMA=resolved.schema;
    env.SNOWFLAKE_WAREHOUSE=resolved.query_warehouse;env.SNOWFLAKE_TABLE_KIND=vars.SNOWFLAKE_TABLE_KIND;
    if(args.includes('--print-sql')){
      const schema={database:resolved.database,schema:resolved.schema,tableKind:vars.SNOWFLAKE_TABLE_KIND};
      const sql=snowflakeSetupStatements(schema);
      if(args.includes('--grant-role')){
        const role=args[args.indexOf('--grant-role')+1];if(!role)throw new Error('--grant-roleに配置するロールを指定してください。');
        sql.push(`GRANT USAGE ON WAREHOUSE ${snowflakeIdentifier(resolved.query_warehouse)} TO ROLE ${snowflakeIdentifier(role)}`,...snowflakeDataGrants(schema,role));
      }
      console.log(sql.map(s=>s+';').join('\n\n'));return;
    }
  }
  const config=snowflakeStorageConfig(env),repo=new SnowflakeBusinessFlowRepository(config);
  try {
    if(process.argv.includes('--create-namespace'))await repo.client.withSession(async session=>{
      await session.query(`CREATE DATABASE IF NOT EXISTS ${snowflakeIdentifier(config.database)}`);
      await session.query(`CREATE SCHEMA IF NOT EXISTS ${snowflakeIdentifier(config.database)}.${snowflakeIdentifier(config.schema)}`);
    });
    await repo.setup();
    console.log(`Snowflake ${config.tableKind}: tables, evidence stage and graph views are ready.`);
  } finally { await repo.close(); }
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
