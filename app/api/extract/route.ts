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
import type { DocumentEvidence } from "@/lib/source-document";
import { getBusinessFlowRepository } from "@/lib/storage";
import { workflowSourceImages } from "@/lib/ai/document-context";
import type { WorkflowCorrection } from "@/lib/ai/workflow-correction";

type ExtractRequest = {
  interview?: string;
  workflow?: Workflow;
  graph?: LensGraph;
  previousReview?: ExtractionReview | null;
  followUpAnswers?: FollowUpAnswer[];
  additionContext?: ReviewAdditionContext;
  projectId?: string;
  documentEvidence?: DocumentEvidence[];
  correction?: WorkflowCorrection;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ExtractRequest;

  if (!body.interview?.trim() || !body.workflow || !body.graph) {
    return NextResponse.json(
      { error: "interview, workflow, and graph are required" },
      { status: 400 },
    );
  }
  if(body.correction && (typeof body.correction.text!=="string" || !body.correction.text.trim() || body.correction.text.length>4000 ||
    (body.correction.stepKey && !body.previousReview?.steps.some(step=>step.stepKey===body.correction!.stepKey))))
    return NextResponse.json({error:"訂正する手順と4000文字までの内容を指定してください。"},{status:400});

  try {
    const evidence = body.documentEvidence ?? body.previousReview?.documentEvidence ?? [];
    const images = evidence.length ? await workflowSourceImages(getBusinessFlowRepository(), body.projectId ?? "", evidence) : [];
    const documentConflicts=(await Promise.all(evidence.map(async ref=>{
      const record=await getBusinessFlowRepository().getSourceDocument(body.projectId??"",ref.documentId);
      return (record?.document.findings??[]).filter(finding=>finding.kind==="conflict").map(finding=>finding.unitIds.filter(id=>ref.unitIds.includes(id)).map(unitId=>({documentId:ref.documentId,unitId})));
    }))).flat().filter(group=>group.length>1);
    const result = hasAIConfig()
      ? await extractWorkflowReviewWithAI({
          interview: body.interview,
          workflow: body.workflow,
          graph: body.graph,
          previousReview: body.previousReview ?? null,
          followUpAnswers: body.followUpAnswers ?? [],
          additionContext: body.additionContext,
          images,
          signal: request.signal,
          correction: body.correction,
          documentConflicts,
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

    return NextResponse.json({ ...result, review: { ...result.review, documentEvidence: evidence.length ? evidence : undefined } });
  } catch (error) {
    const failure = safeAIError(
      error,
      "話を構造として整理できませんでした。メモと前の候補は残っています。再試行してください。",
    );
    console.error("Workflow extraction failed:", failure.code);
    return NextResponse.json(failure, { status: 500 });
  }
}
