import { NextResponse } from "next/server";
import {
  replaceWorkflowGraph,
  type ExtractionReview,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import {
  hasAIConfig,
  resolveWorkflowReviewLocally,
  resolveWorkflowReviewWithAI,
} from "@/lib/ai/provider";

type ApplyRequest = {
  review?: ExtractionReview;
  workflow?: Workflow;
  graph?: LensGraph;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ApplyRequest;

  if (!body.review || !body.workflow || !body.graph) {
    return NextResponse.json(
      { error: "review, workflow, and graph are required" },
      { status: 400 },
    );
  }

  try {
    const result = hasAIConfig()
      ? await resolveWorkflowReviewWithAI({
          review: body.review,
          workflow: body.workflow,
          graph: body.graph,
        })
      : {
          ...resolveWorkflowReviewLocally({
            review: body.review,
            workflow: body.workflow,
            graph: body.graph,
          }),
          provider: "local-demo-resolver",
        };

    const graph = replaceWorkflowGraph(
      body.graph,
      body.workflow,
      result.patch,
    );

    return NextResponse.json({
      graph,
      review: result.review,
      provider: result.provider,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply workflow",
      },
      { status: 500 },
    );
  }
}
