import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import { hasAIConfig, readDocumentWorkItemsWithAI, getAIConfigurationStatus } from "@/lib/ai/provider";
import { safeAIError } from "@/lib/ai/errors";
import { validateDocumentItems } from "@/lib/source-document";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.projectId !== "string" || typeof body.documentId !== "string") return NextResponse.json({error:"資料を指定してください。"},{status:400});
  const repo = getBusinessFlowRepository(), record = await repo.getSourceDocument(body.projectId, body.documentId);
  if (!record) return NextResponse.json({error:"資料が見つかりません。"},{status:404});
  if (record.document.workItems?.length && record.document.analysis) {
    const workItems = validateDocumentItems(record.document, record.document.workItems);
    const document = {...record.document, workItems};
    if (JSON.stringify(workItems) !== JSON.stringify(record.document.workItems)) await repo.saveSourceDocument(body.projectId, document, record.bytes);
    return NextResponse.json({document,cached:true});
  }
  if (!hasAIConfig()) return NextResponse.json({error:"資料の業務分けにはAI接続が必要です。読み取った原資料は保存されています。AIを設定してから再試行できます。"},{status:409});
  try {
    const items = await readDocumentWorkItemsWithAI(record.document);
    const config=getAIConfigurationStatus();
    const document = {...record.document, workItems: items, analysis: {method: "ai" as const, provider: config.runtime ?? config.protocol, model: config.model, completedAt: new Date().toISOString()}};
    await repo.saveSourceDocument(body.projectId, document, record.bytes);
    return NextResponse.json({document,cached:false});
  } catch (error) { const value = safeAIError(error, "資料内の仕事を整理できませんでした。元資料は保存されています。再試行できます。"); return NextResponse.json(value, {status:502}); }
}
