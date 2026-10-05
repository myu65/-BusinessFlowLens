import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import { parseSourceDocument } from "@/lib/source-document-parser";
import { DOCUMENT_MAX_BYTES } from "@/lib/source-document";
import { createHash } from "node:crypto";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > DOCUMENT_MAX_BYTES + 65536) return NextResponse.json({ error: "8MBまでの資料を選んでください。" }, { status: 413 });
    const data = await request.formData(), file = data.get("file"), projectId = data.get("projectId");
    if (!(file instanceof File) || typeof projectId !== "string" || !projectId || file.size > DOCUMENT_MAX_BYTES) return NextResponse.json({error:"プロジェクトと8MBまでの資料を指定してください。"},{status:400});
    const repo = getBusinessFlowRepository();
    const bytes = Buffer.from(await file.arrayBuffer());
    const existing = await repo.findSourceDocument(projectId,createHash("sha256").update(bytes).digest("hex"));
    if (existing) return NextResponse.json({document:existing});
    const document = await parseSourceDocument(file.name, bytes);
    // A first document can start an empty project without first naming a workflow.
    if (!await repo.loadProject(projectId)) await repo.saveProject({ projectId, projectName: "資料から始めるプロジェクト", graph: {workflows:[],nodes:[],edges:[],dataFlows:[]}, transcripts: {}, updatedAt: new Date().toISOString() });
    await repo.saveSourceDocument(projectId, document, bytes);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "資料を読み取れませんでした。";
    return NextResponse.json({ error: /Excel|PDF|読み|8MB|文字|シート|ページ/.test(message) ? message : "資料を読み取れませんでした。暗号化や破損のないExcel・PDFを選んでください。" }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url), projectId = url.searchParams.get("projectId"), id = url.searchParams.get("id");
  if (!projectId) return NextResponse.json({error:"プロジェクトを指定してください。"},{status:400});
  const repo = getBusinessFlowRepository();
  if (!id) return NextResponse.json({ documents: await repo.listSourceDocuments(projectId) });
  const record = await repo.getSourceDocument(projectId, id);
  if (!record) return NextResponse.json({error:"元資料が見つかりません。"},{status:404});
  if (url.searchParams.get("original") === "1") return new Response(new Uint8Array(record.bytes), { headers: {
    "Content-Type": record.document.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.document.name)}`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
  return NextResponse.json({document:record.document}, {headers:{"Cache-Control":"no-store"}});
}
