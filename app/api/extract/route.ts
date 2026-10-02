import { extractGroundedLocal } from "@/lib/local-review";
import { NextResponse } from "next/server";
import {
  type ExtractionReview,
  type FollowUpAnswer,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import { extractWorkflowReviewWithAI, hasAIConfig } from "@/lib/ai/provider";

type ExtractRequest = {
  interview?: string;
  workflow?: Workflow;
  graph?: LensGraph;
  previousReview?: ExtractionReview | null;
  followUpAnswers?: FollowUpAnswer[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as ExtractRequest;

  if (!body.interview?.trim() || !body.workflow || !body.graph) {
    return NextResponse.json(
      { error: "interview, workflow, and graph are required" },
      { status: 400 },
    );
  }

  try {
    const result = hasAIConfig()
      ? await extractWorkflowReviewWithAI({
          interview: body.interview,
          workflow: body.workflow,
          graph: body.graph,
          previousReview: body.previousReview ?? null,
          followUpAnswers: body.followUpAnswers ?? [],
        })
      : (() => {
          const baseReview =
            body.followUpAnswers?.some((answer) => answer.answer.trim()) &&
            body.previousReview?.steps.length
              ? body.previousReview
              : extractGroundedLocal(body.interview!, body.previousReview);
          const answered = new Set(
            (body.followUpAnswers ?? [])
              .filter((item) => item.answer.trim())
              .map((item) => item.question),
          );

          return {
            review: {
              ...baseReview,
              questions: baseReview.questions.filter(
                (question) => !answered.has(question.question),
              ),
              warnings:
                answered.size > 0
                  ? [
                      ...baseReview.warnings,
                      "AI未接続のため回答を根拠として保存します。内容は右側のモデルへ直接反映してください。",
                    ]
                  : baseReview.warnings,
            },
            provider: "local-demo-extractor",
          };
        })();

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to extract workflow",
      },
      { status: 500 },
    );
  }
}
