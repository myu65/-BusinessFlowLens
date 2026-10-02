import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";

const DEFAULT_PROJECT_ID = "default";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId =
      url.searchParams.get("projectId")?.trim() || DEFAULT_PROJECT_ID;
    const repository = getBusinessFlowRepository();

    const revisionId = Number(
      url.searchParams.get("revisionId") ?? "0",
    );

    if (revisionId > 0) {
      const revision = await repository.getWorkflowRevision(
        projectId,
        revisionId,
      );
      return NextResponse.json({ revision });
    }

    const workflowId = url.searchParams.get("workflowId")?.trim();
    if (!workflowId) {
      return NextResponse.json(
        { error: "workflowId is required" },
        { status: 400 },
      );
    }

    const revisions = await repository.listWorkflowRevisions(
      projectId,
      workflowId,
    );

    return NextResponse.json({ revisions });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load workflow revisions",
      },
      { status: 500 },
    );
  }
}
