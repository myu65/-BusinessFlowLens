import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import { parseSourceDocument } from "@/lib/source-document-parser";
import { needsSourceRendering, type SourceImage } from "@/lib/source-document";
import { replaceSourceRendition } from "@/lib/source-rendition";
import { SourceDocumentChangedError } from "@/lib/storage/repository";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.projectId !== "string" || typeof body.documentId !== "string") return NextResponse.json({error:"資料を指定してください。"},{status:400});
  const repo = getBusinessFlowRepository(), record = await repo.getSourceDocument(body.projectId, body.documentId);
  if (!record) return NextResponse.json({error:"元資料が見つかりません。"},{status:404});
  if (record.document.lifecycle?.state === "withdrawn") return NextResponse.json({error:"資料の読取りは取り消されています。"},{status:409});
  if (!needsSourceRendering(record.document)) return NextResponse.json({document:record.document,cached:true});
  try {
    // Retire an old rendering's generation before re-reading; a late AI result cannot overwrite it or undo withdrawal.
    const refreshing = record.document.format === "pdf" && record.document.rendering?.status === "ready";
    const current = refreshing ? await repo.setSourceDocumentState(body.projectId, body.documentId, "active", record.document.lifecycle?.generation ?? 0) : record.document;
    if (!current) throw new SourceDocumentChangedError();
    const images: SourceImage[] = [];
    const parsed = await parseSourceDocument(record.document.name, Buffer.from(record.bytes), {onImage:image=>images.push(image)});
    const document = replaceSourceRendition(record.document, parsed, current.lifecycle);
    await repo.saveSourceDocument(body.projectId, document, record.bytes, images);
    return NextResponse.json({document,cached:false});
  } catch (error) {
    const message = error instanceof Error ? error.message : "ページを読み取れませんでした。";
    return NextResponse.json({error:`${/資料|ページ|Word|PowerPoint|Excel|PDF|画像|読み|\.xlsx/.test(message)?message:"ページを読み取れませんでした。"} 元資料は保存されています。`},{status:error instanceof SourceDocumentChangedError || message.includes("取り消")?409:422});
  }
}
