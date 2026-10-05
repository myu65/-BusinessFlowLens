import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import { parseSourceDocument } from "@/lib/source-document-parser";
import type { SourceImage } from "@/lib/source-document";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.projectId !== "string" || typeof body.documentId !== "string") return NextResponse.json({error:"資料を指定してください。"},{status:400});
  const repo = getBusinessFlowRepository(), record = await repo.getSourceDocument(body.projectId, body.documentId);
  if (!record) return NextResponse.json({error:"元資料が見つかりません。"},{status:404});
  if (record.document.lifecycle?.state === "withdrawn") return NextResponse.json({error:"資料の読取りは取り消されています。"},{status:409});
  if (record.document.rendering?.status !== "pending" && record.document.rendering?.status !== "unavailable") return NextResponse.json({document:record.document,cached:true});
  try {
    const images: SourceImage[] = [];
    const parsed = await parseSourceDocument(record.document.name, Buffer.from(record.bytes), {onImage:image=>images.push(image)});
    const document = {...parsed,id:record.document.id,createdAt:record.document.createdAt,lifecycle:record.document.lifecycle};
    await repo.saveSourceDocument(body.projectId, document, record.bytes, images);
    return NextResponse.json({document,cached:false});
  } catch (error) {
    const message = error instanceof Error ? error.message : "ページを読み取れませんでした。";
    return NextResponse.json({error:`${/資料|ページ|Word|PowerPoint|Excel|PDF|画像|読み|\.xlsx/.test(message)?message:"ページを読み取れませんでした。"} 元資料は保存されています。`},{status:message.includes("取り消")?409:422});
  }
}
