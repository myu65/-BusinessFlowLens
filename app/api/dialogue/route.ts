import { NextResponse } from 'next/server';
import { planDialogueOperation } from '@/lib/ai/dialogue';
import { safeAIError } from '@/lib/ai/errors';
import type { ExtractionReview, LensGraph, Workflow } from '@/lib/graph';
import type { DialogueTurn } from '@/lib/dialogue-operations';

export async function POST(request:Request){
  try{
    const body=await request.json() as {text?:string;graph?:LensGraph;workflow?:Workflow;review?:ExtractionReview;turns?:DialogueTurn[];selectedStepKey?:string};
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000||!body.graph||!body.workflow||!Array.isArray(body.review?.steps)||!Array.isArray(body.turns??[])|| (body.turns??[]).length>100)return NextResponse.json({error:'4000文字までの話と、現在の業務・図を指定してください。'},{status:400});
    const result=await planDialogueOperation({graph:body.graph,workflow:body.workflow,review:body.review,text:body.text,turns:body.turns??[],selectedStepKey:body.selectedStepKey,signal:request.signal});
    return NextResponse.json(result);
  }catch(error){return NextResponse.json(safeAIError(error,'対話の操作案を作れませんでした。入力した話と図は残っています。'),{status:500});}
}
