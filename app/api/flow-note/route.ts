import { NextResponse } from "next/server";
import { hasAIConfig, extractWorkflowReviewWithAI } from "@/lib/ai/provider";
import { planFlowAddition, reviewFlowNote } from "@/lib/flow-note";
import type { LensGraph } from "@/lib/graph";
import { safeAIError } from "@/lib/ai/errors";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      graph?: LensGraph;
      workflowId?: string;
      afterStepId?: string;
      note?: string;
      id?: string;
    };
    if (
      !Array.isArray(body.graph?.workflows) ||
      !Array.isArray(body.graph?.nodes) ||
      !Array.isArray(body.graph?.edges) ||
      !Array.isArray(body.graph?.dataFlows) ||
      typeof body.workflowId !== "string" ||
      !body.workflowId ||
      typeof body.afterStepId !== "string" ||
      !body.afterStepId ||
      typeof body.note !== "string" ||
      !body.note.trim() ||
      typeof body.id !== "string" ||
      !body.id ||
      !/^[\w-]{1,80}$/.test(body.id) ||
      body.note.length > 4000
    )
      return NextResponse.json(
        { error: "業務、接続先、4000文字以内のメモが必要です。" },
        { status: 400 },
      );
    const workflow = body.graph.workflows.find((w) => w.id === body.workflowId);
    if (!workflow)
      return NextResponse.json(
        { error: "業務が見つかりません。" },
        { status: 404 },
      );
    const result = hasAIConfig()
      ? await extractWorkflowReviewWithAI({
          interview: `既存の手順を変更せず、次の追加メモに明記された新しい作業だけを抽出してください。\n${body.note}`,
          workflow,
          graph: body.graph,
          previousReview: null,
        })
      : {
          review: reviewFlowNote(body.note, body.graph, body.workflowId),
          provider: "grounded-note-parser",
        };
    const plan = planFlowAddition(
      body.graph,
      body.workflowId,
      body.afterStepId,
      body.note,
      body.id,
      result.review,
    );
    return NextResponse.json({ plan, provider: result.provider });
  } catch (error) {
    return NextResponse.json(
      safeAIError(
        error,
        "メモを整理できませんでした。元の流れは残っています。接続先とメモを確認して再試行してください。",
      ),
      { status: 400 },
    );
  }
}
