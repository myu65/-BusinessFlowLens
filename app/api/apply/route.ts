import { NextResponse } from "next/server";
import { safeAIError } from "@/lib/ai/errors";
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
import { applyReviewConnections } from "@/lib/review-workbench";
import {
  applyInputOrganization,
  reviewedWorkflowName,
} from "@/lib/input-knowledge";

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

  if (!body.review || !body.workflow || !body.graph || !body.transcripts) {
    return NextResponse.json(
      {
        error: "review, workflow, graph, and transcripts are required",
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

    const reviewedWorkflow: Workflow = {
      ...body.workflow,
      name: reviewedWorkflowName(body.workflow, result.review),
      summary: result.review.summary,
      trigger: result.review.trigger,
      outcome: result.review.outcome,
      reviewContext: {
        summary: result.review.summary,
        trigger: result.review.trigger,
        outcome: result.review.outcome,
        questions: result.review.questions,
        warnings: result.review.warnings,
        followUpAnswers: body.followUpAnswers ?? [],
        excludedSteps: result.review.excludedSteps,
        extraction: result.review.extraction,
        protectedDetails: result.review.protectedDetails,
        organization: result.review.organization,
        systemProfiles: result.review.systemProfiles,
        systemDependencies: result.review.systemDependencies,
        documentEvidence: result.review.documentEvidence,
      },
    };
    const connected = applyReviewConnections(
      replaceWorkflowGraph(body.graph, reviewedWorkflow, result.patch),
      reviewedWorkflow,
      result.review,
    );
    const graph = applyInputOrganization(
      connected,
      reviewedWorkflow,
      result.review,
      body.graph,
    );

    const projectId = body.projectId?.trim() || "default";
    const projectName = body.projectName?.trim() || "BusinessFlowLens";
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
      workflowName: reviewedWorkflow.name,
      workflowDescription: body.workflow.description,
      familyId: body.workflow.familyId ?? body.workflow.id,
      scenario: body.workflow.scenario ?? "current",
      scenarioLabel: body.workflow.scenarioLabel,
      basedOnWorkflowId: body.workflow.basedOnWorkflowId,
      effectiveFrom: body.workflow.effectiveFrom,
      effectiveTo: body.workflow.effectiveTo,
      sourceNotes: body.sourceNotes ?? body.transcripts[body.workflow.id] ?? "",
      followUpAnswers: body.followUpAnswers ?? [],
      review: result.review,
      updatedBy: requestUser(request),
      createdAt: now,
    });

    // Read back the persisted snapshot so legacy node IDs healed by the
    // repository are also reflected in the client state immediately.
    const persisted = await repository.loadProject(projectId);

    return NextResponse.json({
      graph: persisted?.graph ?? graph,
      transcripts: persisted?.transcripts ?? body.transcripts,
      review: result.review,
      revision,
      provider: result.provider,
      storage: process.env.BUSINESS_FLOW_STORAGE ?? "sqlite",
    });
  } catch (error) {
    const failure = safeAIError(
      error,
      "流れを保存できませんでした。メモと候補は残っています。再試行してください。",
    );
    console.error("Workflow apply failed:", failure.code);
    return NextResponse.json(failure, { status: 500 });
  }
}
