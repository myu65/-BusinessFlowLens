import { extractGroundedLocal } from "@/lib/local-review";
import { NextResponse } from "next/server";
import {
  type ExtractionReview,
  type FollowUpAnswer,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import { extractWorkflowReviewWithAI, hasAIConfig } from "@/lib/ai/provider";
import { safeAIError } from "@/lib/ai/errors";
import type { ReviewAdditionContext } from "@/lib/review-addition";

type ExtractRequest = {
  interview?: string;
  workflow?: Workflow;
  graph?: LensGraph;
  previousReview?: ExtractionReview | null;
  followUpAnswers?: FollowUpAnswer[];
  additionContext?: ReviewAdditionContext;
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
          additionContext: body.additionContext,
        })
      : (() => {
          const baseReview = extractGroundedLocal(
            body.interview!,
            body.previousReview,
            body.graph,
            body.followUpAnswers,
          );

          return {
            review: {
              ...baseReview,
              extraction: {
                method: "local" as const,
                provider: "local-demo-extractor",
                completedAt: new Date().toISOString(),
              },
              warnings: [...new Set(baseReview.warnings)],
            },
            provider: "local-demo-extractor",
          };
        })();

    return NextResponse.json(result);
  } catch (error) {
    const failure = safeAIError(
      error,
      "話を構造として整理できませんでした。メモと前の候補は残っています。再試行してください。",
    );
    console.error("Workflow extraction failed:", failure.code);
    return NextResponse.json(failure, { status: 500 });
  }
}
