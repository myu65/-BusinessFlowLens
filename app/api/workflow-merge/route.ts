import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getBusinessFlowRepository } from '@/lib/storage';
import { ProjectChangedError } from '@/lib/storage/repository';
import { commitWorkflowMerge, previewWorkflowMerge, undoWorkflowMerge, type WorkflowMergeChoice } from '@/lib/workflow-merge';
import { previewReviewGraph, type InputDraft } from '@/lib/review-workbench';
import type {DialogueTurn} from '@/lib/dialogue-operations';

export async function POST(request: Request) {
  try {
    const body=await request.json() as {projectId?:string; mode?:'preview'|'apply'|'undo'|'preview-undo'; sourceId?:string;targetId?:string;choices?:WorkflowMergeChoice[];expectedUpdatedAt?:string;recordId?:string;draft?:Pick<InputDraft,'workflow'|'review'|'sourceNotes'|'answerHistory'>;dialogue?:{workflowId:string;turns:DialogueTurn[]}};
    if(!body.projectId?.trim()||!['preview','apply','undo','preview-undo'].includes(body.mode??''))return NextResponse.json({error:'プロジェクトと操作を指定してください。'},{status:400});
    const repository=getBusinessFlowRepository(),snapshot=await repository.loadProject(body.projectId);
    if(!snapshot)return NextResponse.json({error:'保存済みのプロジェクトが見つかりません。'},{status:404});
    if(!['preview','preview-undo'].includes(body.mode!)&&(!body.expectedUpdatedAt||snapshot.updatedAt!==body.expectedUpdatedAt))throw new ProjectChangedError();
    const now=new Date().toISOString();
    if(body.mode==='undo'||body.mode==='preview-undo'){
      const result=undoWorkflowMerge(snapshot.graph,snapshot.transcripts,body.recordId??'',now);
      if(body.mode==='preview-undo')return NextResponse.json({project:{...snapshot,...result},restoredId:result.restoredId,expectedUpdatedAt:snapshot.updatedAt});
      if(body.dialogue){
        if(!Array.isArray(body.dialogue.turns)||!result.graph.workflows.some(w=>w.id===body.dialogue!.workflowId))throw new Error('対話の対象業務を確認できませんでした。');
        result.graph={...result.graph,workflows:result.graph.workflows.map(w=>[body.dialogue!.workflowId,result.restoredId].includes(w.id)?{...w,reviewContext:{...(w.reviewContext??{summary:w.summary??w.description??w.name,trigger:w.trigger??null,outcome:w.outcome??null,questions:[],warnings:[]}),dialogueHistory:[...new Map([...(w.reviewContext?.dialogueHistory??[]),...body.dialogue!.turns].map(t=>[t.id,t])).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))}}:w)};
      }
      await repository.saveProject({...snapshot,...result,updatedAt:now},snapshot.updatedAt);
      const saved=await repository.loadProject(snapshot.projectId);
      return NextResponse.json({project:saved,restoredId:result.restoredId});
    }
    if(!body.sourceId||!body.targetId||!Array.isArray(body.choices))return NextResponse.json({error:'二つの業務と手順の対応を確認してください。'},{status:400});
    let graph=snapshot.graph,transcripts=snapshot.transcripts;
    if(body.draft){
      if(![body.sourceId,body.targetId].includes(body.draft.workflow?.id)||!Array.isArray(body.draft.review?.steps)||typeof body.draft.sourceNotes!=='string')throw new Error('保存前の候補を確認できませんでした。');
      graph=previewReviewGraph(graph,body.draft.workflow,body.draft.review);
      graph={...graph,workflows:graph.workflows.map(w=>w.id===body.draft!.workflow.id?{...w,reviewContext:{...w.reviewContext!,followUpAnswers:body.draft!.answerHistory}}:w)};
      transcripts={...transcripts,[body.draft.workflow.id]:body.draft.sourceNotes};
    }
    const input={graph,transcripts,sourceId:body.sourceId,targetId:body.targetId,choices:body.choices};
    if(body.mode==='preview'){
      const result=previewWorkflowMerge(input);
      return NextResponse.json({...result,expectedUpdatedAt:snapshot.updatedAt});
    }
    const result=commitWorkflowMerge(input,{id:randomUUID(),createdAt:now,updatedBy:request.headers.get('x-business-flow-user')?.trim()||process.env.BUSINESS_FLOW_LOCAL_USER?.trim()||'local-user'});
    // The graph, both originals and the undo delta are committed in one repository transaction.
    await repository.saveProject({...snapshot,graph:result.graph,transcripts:result.transcripts,updatedAt:now},snapshot.updatedAt);
    return NextResponse.json({project:await repository.loadProject(snapshot.projectId),recordId:result.record.id,count:result.count});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:'統合できませんでした。元の業務は残っています。'}, {status:error instanceof ProjectChangedError?409:400});
  }
}
