import { NextResponse } from "next/server";
import {
  extractInterviewLocal,
  replaceWorkflowGraph,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import { extractGraphWithAI, hasAIConfig } from "@/lib/ai/provider";

type ExtractRequest = {
  interview?: string;
  workflow?: Workflow;
  graph?: LensGraph;
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
      ? await extractGraphWithAI({
          interview: body.interview,
          workflow: body.workflow,
          graph: body.graph,
        })
      : {
          patch: extractInterviewLocal(
            body.interview,
            body.workflow.id,
          ),
          provider: "local-demo-extractor",
        };

    const graph = replaceWorkflowGraph(
      body.graph,
      body.workflow,
      result.patch,
    );

    return NextResponse.json({
      graph,
      questions: result.patch.questions,
      provider: result.provider,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to extract graph",
      },
      { status: 500 },
    );
  }
}
