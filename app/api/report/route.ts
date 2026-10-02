import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import { knowledgeReport, type KnowledgeScope } from "@/lib/knowledge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "current";
  if (!["current", "future", "alternative"].includes(scope))
    return NextResponse.json({ error: "Invalid scenario" }, { status: 400 });
  const project = await getBusinessFlowRepository().loadProject(
    url.searchParams.get("projectId") || "default",
  );
  if (!project)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const ids = url.searchParams.has("workflows")
    ? (url.searchParams.get("workflows") ?? "").split(",").filter(Boolean)
    : undefined;
  const report = knowledgeReport(
    project.graph,
    scope as KnowledgeScope,
    url.searchParams.get("query") ?? "",
    url.searchParams.get("department") ?? "",
    ids,
    url.searchParams.get("assetId") ?? undefined,
  );
  return new Response(report, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="business-knowledge-${scope}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
