import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getBusinessFlowRepository } from '@/lib/storage';
import { ProjectChangedError } from '@/lib/storage/repository';
import { commitAssetMutation, previewAssetMutation, undoAssetMutation } from '@/lib/asset-merge';
import type {DialogueTurn} from '@/lib/dialogue-operations';

export async function POST(request:Request){
  try{
    const body=await request.json() as {projectId?:string;mode?:'preview'|'apply'|'undo'|'preview-undo';sourceId?:string;targetId?:string;name?:string;evidence?:string;acceptTargetProfile?:boolean;expectedUpdatedAt?:string;recordId?:string;dialogue?:{workflowId:string;turns:DialogueTurn[]}};
    if(!body.projectId?.trim()||!['preview','apply','undo','preview-undo'].includes(body.mode??''))return NextResponse.json({error:'プロジェクトと操作を指定してください。'},{status:400});
    const repo=getBusinessFlowRepository(),snapshot=await repo.loadProject(body.projectId);
    if(!snapshot)return NextResponse.json({error:'保存済みのプロジェクトが見つかりません。'},{status:404});
    if(!['preview','preview-undo'].includes(body.mode!)&&(!body.expectedUpdatedAt||body.expectedUpdatedAt!==snapshot.updatedAt))throw new ProjectChangedError();
    const now=new Date().toISOString();
    if(body.mode==='undo'||body.mode==='preview-undo'){
      let graph=undoAssetMutation(snapshot.graph,body.recordId??'',now);if(body.mode==='preview-undo')return NextResponse.json({project:{...snapshot,graph},expectedUpdatedAt:snapshot.updatedAt});
      if(body.dialogue){
        if(!Array.isArray(body.dialogue.turns)||!graph.workflows.some(w=>w.id===body.dialogue!.workflowId))throw new Error('対話の対象業務を確認できませんでした。');
        graph={...graph,workflows:graph.workflows.map(w=>w.id===body.dialogue!.workflowId?{...w,reviewContext:{...(w.reviewContext??{summary:w.summary??w.description??w.name,trigger:w.trigger??null,outcome:w.outcome??null,questions:[],warnings:[]}),dialogueHistory:body.dialogue!.turns}}:w)};
      }
      await repo.saveProject({...snapshot,graph,updatedAt:now},snapshot.updatedAt);
      return NextResponse.json({project:await repo.loadProject(body.projectId)});
    }
    if(typeof body.sourceId!=='string'||typeof body.evidence!=='string'||!body.evidence.trim()||body.evidence.length>4000||body.targetId!==undefined&&typeof body.targetId!=='string'||body.name!==undefined&&typeof body.name!=='string')return NextResponse.json({error:'対象と4000文字までの変更理由を指定してください。'},{status:400});
    const input={graph:snapshot.graph,sourceId:body.sourceId,targetId:body.targetId,name:body.name,evidence:body.evidence,acceptTargetProfile:body.acceptTargetProfile===true};
    if(body.mode==='preview')return NextResponse.json({...previewAssetMutation(input),expectedUpdatedAt:snapshot.updatedAt});
    if(body.dialogue){
      if(!Array.isArray(body.dialogue.turns)||!snapshot.graph.workflows.some(w=>w.id===body.dialogue!.workflowId))throw new Error('対話の対象業務を確認できませんでした。');
      input.graph={...input.graph,workflows:input.graph.workflows.map(w=>w.id===body.dialogue!.workflowId?{...w,reviewContext:{...(w.reviewContext??{summary:w.summary??w.description??w.name,trigger:w.trigger??null,outcome:w.outcome??null,questions:[],warnings:[]}),dialogueHistory:body.dialogue!.turns}}:w)};
    }
    const result=commitAssetMutation(input,{id:randomUUID(),createdAt:now,updatedBy:request.headers.get('x-business-flow-user')?.trim()||process.env.BUSINESS_FLOW_LOCAL_USER?.trim()||'local-user'});
    await repo.saveProject({...snapshot,graph:result.graph,updatedAt:now},snapshot.updatedAt);
    return NextResponse.json({project:await repo.loadProject(body.projectId),recordId:result.record.id});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'変更できませんでした。元の構造は残っています。'},{status:error instanceof ProjectChangedError?409:400});}
}
