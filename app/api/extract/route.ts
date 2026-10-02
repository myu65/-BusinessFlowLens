import { NextResponse } from "next/server";
import {
  extractInterviewLocal,
  replaceWorkflowGraph,
  type ExtractionReview,
  type GraphPatch,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import { extractGraphWithAI, hasAIConfig } from "@/lib/ai/provider";

type ExtractRequest = {
  interview?: string;
  workflow?: Workflow;
  graph?: LensGraph;
};

function localReview(patch: GraphPatch): ExtractionReview {
  const byKey = new Map(
    patch.nodes.map((node) => [node.canonicalKey, node]),
  );
  const processes = patch.nodes
    .filter((node) => node.kind === "process")
    .map((node, index) => {
      const systems: ExtractionReview["steps"][number]["systems"] = [];
      const data: ExtractionReview["steps"][number]["data"] = [];

      for (const edge of patch.edges) {
        if (edge.sourceKey !== node.canonicalKey) continue;
        const target = byKey.get(edge.targetKey);
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
        stepKey: node.canonicalKey.split(":").at(-1) ?? `step-${index + 1}`,
        name: node.label,
        order: node.stepOrder ?? index + 1,
        actor: node.actor ?? null,
        action: node.action ?? node.description,
        certainty: node.status === "confirmed" ? "explicit" : "inferred",
        evidence: node.evidence ?? "",
        systems,
        data,
      } as const;
    });

  return {
    summary:
      processes.length > 0
        ? `${processes[0].name}から始まる${processes.length}ステップの業務として抽出しました。`
        : "ローカルデモ抽出では業務ステップを特定できませんでした。",
    trigger: null,
    outcome: null,
    steps: processes,
    questions: patch.questions.map((question) => ({
      question,
      reason: "ヒアリングから確定できないため",
      target: "scope" as const,
    })),
    warnings: [
      "AI endpoint未設定のためローカルデモ抽出を使用しています。精度確認にはAI structured extractionを利用してください。",
    ],
  };
}

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
      ? await extractGraphWithAI({
          interview: body.interview,
          workflow: body.workflow,
          graph: body.graph,
        })
      : (() => {
          const patch = extractInterviewLocal(
            body.interview!,
            body.workflow!.id,
          );
          return {
            patch,
            review: localReview(patch),
            provider: "local-demo-extractor",
          };
        })();

    const previewGraph = replaceWorkflowGraph(
      body.graph,
      body.workflow,
      result.patch,
    );

    return NextResponse.json({
      previewGraph,
      review: result.review,
      questions: result.review.questions,
      provider: result.provider,
    });
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
