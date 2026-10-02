import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import type { ProjectSnapshot } from "@/lib/storage/repository";

const DEFAULT_PROJECT_ID = "default";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId =
      url.searchParams.get("projectId")?.trim() || DEFAULT_PROJECT_ID;

    const repository = getBusinessFlowRepository();
    const snapshot = await repository.loadProject(projectId);

    return NextResponse.json({
      project: snapshot,
      storage: process.env.BUSINESS_FLOW_STORAGE ?? "sqlite",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load project",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<ProjectSnapshot>;

    if (
      !body.projectId ||
      !body.projectName ||
      !body.graph ||
      !body.transcripts
    ) {
      return NextResponse.json(
        {
          error:
            "projectId, projectName, graph, and transcripts are required",
        },
        { status: 400 },
      );
    }

    const snapshot: ProjectSnapshot = {
      projectId: body.projectId,
      projectName: body.projectName,
      graph: body.graph,
      transcripts: body.transcripts,
      updatedAt: new Date().toISOString(),
    };

    const repository = getBusinessFlowRepository();
    await repository.saveProject(snapshot);

    return NextResponse.json({
      ok: true,
      updatedAt: snapshot.updatedAt,
      storage: process.env.BUSINESS_FLOW_STORAGE ?? "sqlite",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save project",
      },
      { status: 500 },
    );
  }
}
