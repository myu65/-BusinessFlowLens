import { NextResponse } from "next/server";
import {
  extractInterviewLocal,
  type ExtractionReview,
  type GraphPatch,
  type Workflow,
} from "@/lib/graph";
import {
  extractWorkflowReviewWithAI,
  hasAIConfig,
} from "@/lib/ai/provider";

type ExtractRequest = {
  interview?: string;
  workflow?: Workflow;
};

function localReview(patch: GraphPatch): ExtractionReview {
  const byKey = new Map(
    patch.nodes.map((node) => [node.canonicalKey, node]),
  );
  const processNodes = patch.nodes.filter(
    (node) => node.kind === "process",
  );

  const steps = processNodes.map((node, index) => {
    const systems: ExtractionReview["steps"][number]["systems"] = [];
    const data: ExtractionReview["steps"][number]["data"] = [];

    for (const edge of patch.edges) {
      if (
        edge.sourceKey !== node.canonicalKey &&
        edge.targetKey !== node.canonicalKey
      ) {
        continue;
      }

      const otherKey =
        edge.sourceKey === node.canonicalKey
          ? edge.targetKey
          : edge.sourceKey;
      const target = byKey.get(otherKey);
      if (!target) continue;

      if (target.kind === "system") {
        systems.push({
          name: target.label,
          interaction:
            edge.label === "search"
              ? "search"
              : edge.label === "input" || edge.label === "手入力"
                ? "input"
                : "other",
          evidence: target.evidence ?? "",
        });
      }

      if (target.kind === "data") {
        data.push({
          name: target.label,
          operation:
            edge.relation === "reads"
              ? "read"
              : edge.relation === "writes"
                ? "update"
                : "send",
          evidence: target.evidence ?? "",
        });
      }
    }

    return {
      stepKey:
        node.canonicalKey.split(":").at(-1) ?? `step-${index + 1}`,
      name: node.label,
      order: node.stepOrder ?? index + 1,
      actor: node.actor ?? null,
      department: node.department ?? null,
      responsiblePerson: node.responsiblePerson ?? null,
      action: node.action ?? node.description,
      certainty:
        node.status === "confirmed"
          ? ("explicit" as const)
          : ("inferred" as const),
      evidence: node.evidence ?? "",
      systems,
      data,
    };
  });

  const processKeys = new Set(
    processNodes.map((node) => node.canonicalKey),
  );
  const transitions = patch.edges
    .filter(
      (edge) =>
        edge.relation === "next" &&
        processKeys.has(edge.sourceKey) &&
        processKeys.has(edge.targetKey),
    )
    .map((edge) => ({
      fromStepKey: edge.sourceKey.split(":").at(-1) ?? edge.sourceKey,
      toStepKey: edge.targetKey.split(":").at(-1) ?? edge.targetKey,
      condition: edge.label ?? null,
      evidence: "",
    }));

  return {
    summary:
      steps.length > 0
        ? `${steps[0].name}から始まる${steps.length}ステップの業務として抽出しました。`
        : "ローカルデモ抽出では業務ステップを特定できませんでした。",
    trigger: null,
    outcome: null,
    steps,
    transitions,
    dataFlows: [],
    questions: patch.questions.map((question) => ({
      question,
      reason: "ヒアリングから確定できないため",
      target: "scope" as const,
    })),
    warnings: [
      "AI endpoint未設定のためローカルデモ抽出を使用しています。",
    ],
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as ExtractRequest;

  if (!body.interview?.trim() || !body.workflow) {
    return NextResponse.json(
      { error: "interview and workflow are required" },
      { status: 400 },
    );
  }

  try {
    const result = hasAIConfig()
      ? await extractWorkflowReviewWithAI({
          interview: body.interview,
          workflow: body.workflow,
        })
      : (() => {
          const patch = extractInterviewLocal(
            body.interview!,
            body.workflow!.id,
          );
          return {
            review: localReview(patch),
            provider: "local-demo-extractor",
          };
        })();

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to extract workflow",
      },
      { status: 500 },
    );
  }
}
