import { NextResponse } from "next/server";
import {
  replaceWorkflowGraph,
  type ExtractionReview,
  type FollowUpAnswer,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import {
  hasAIConfig,
  resolveWorkflowReviewLocally,
  resolveWorkflowReviewWithAI,
} from "@/lib/ai/provider";
import { getBusinessFlowRepository } from "@/lib/storage";

type ApplyRequest = {
  projectId?: string;
  projectName?: string;
  review?: ExtractionReview;
  workflow?: Workflow;
  graph?: LensGraph;
  transcripts?: Record<string, string>;
  sourceNotes?: string;
  followUpAnswers?: FollowUpAnswer[];
};

function requestUser(request: Request) {
  return (
    request.headers.get("Sf-Context-Current-User")?.trim() ||
    request.headers.get("x-business-flow-user")?.trim() ||
    process.env.BUSINESS_FLOW_LOCAL_USER?.trim() ||
    "local-user"
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as ApplyRequest;

  if (
    !body.review ||
    !body.workflow ||
    !body.graph ||
    !body.transcripts
  ) {
    return NextResponse.json(
      {
        error:
          "review, workflow, graph, and transcripts are required",
      },
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

    const projectId = body.projectId?.trim() || "default";
    const projectName =
      body.projectName?.trim() || "BusinessFlowLens";
    const now = new Date().toISOString();
    const repository = getBusinessFlowRepository();

    await repository.saveProject({
      projectId,
      projectName,
      graph,
      transcripts: body.transcripts,
      updatedAt: now,
    });

    const revision = await repository.appendWorkflowRevision({
      projectId,
      workflowId: body.workflow.id,
      workflowName: body.workflow.name,
      workflowDescription: body.workflow.description,
      familyId: body.workflow.familyId ?? body.workflow.id,
      scenario: body.workflow.scenario ?? "current",
      scenarioLabel: body.workflow.scenarioLabel,
      basedOnWorkflowId: body.workflow.basedOnWorkflowId,
      effectiveFrom: body.workflow.effectiveFrom,
      effectiveTo: body.workflow.effectiveTo,
      sourceNotes:
        body.sourceNotes ?? body.transcripts[body.workflow.id] ?? "",
      followUpAnswers: body.followUpAnswers ?? [],
      review: result.review,
      updatedBy: requestUser(request),
      createdAt: now,
    });

    return NextResponse.json({
      graph,
      review: result.review,
      revision,
      provider: result.provider,
      storage: process.env.BUSINESS_FLOW_STORAGE ?? "sqlite",
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
