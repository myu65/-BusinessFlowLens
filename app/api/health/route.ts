import { NextResponse } from 'next/server';
import {getBusinessFlowRepository} from '@/lib/storage';
import {getAIConfigurationStatus} from '@/lib/ai/provider';
export const dynamic='force-dynamic';
export async function GET(){
  try{
    await getBusinessFlowRepository().loadProject('__health__');
    return NextResponse.json({ready:true,storage:process.env.BUSINESS_FLOW_STORAGE??'sqlite',tableKind:process.env.BUSINESS_FLOW_STORAGE==='snowflake'?process.env.SNOWFLAKE_TABLE_KIND??'standard':null,ai:getAIConfigurationStatus()},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({ready:false,error:error instanceof Error?error.message:'保存先に接続できません。'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
