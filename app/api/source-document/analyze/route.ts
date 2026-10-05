import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
import { hasAIConfig, readDocumentImagesWithAI, readDocumentWorkItemsWithAI, getAIConfigurationStatus } from "@/lib/ai/provider";
import { safeAIError } from "@/lib/ai/errors";
import { needsSourceRendering, validateDocumentItems } from "@/lib/source-document";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.projectId !== "string" || typeof body.documentId !== "string") return NextResponse.json({error:"資料を指定してください。"},{status:400});
  const repo = getBusinessFlowRepository(), record = await repo.getSourceDocument(body.projectId, body.documentId);
  if (!record) return NextResponse.json({error:"資料が見つかりません。"},{status:404});
  if (record.document.lifecycle?.state === "withdrawn") return NextResponse.json({error:"資料の読取りは取り消されています。"},{status:409});
  if (needsSourceRendering(record.document)) return NextResponse.json({error:record.document.rendering?.message??"先に資料のページを読み込んでください。元資料は保存されています。"},{status:409});
  if (record.document.workItems?.length && record.document.analysis) {
    const workItems = validateDocumentItems(record.document, record.document.workItems);
    const document = {...record.document, workItems};
    if (JSON.stringify(workItems) !== JSON.stringify(record.document.workItems)) await repo.saveSourceDocument(body.projectId, document, record.bytes);
    return NextResponse.json({document,cached:true});
  }
  if (!hasAIConfig()) return NextResponse.json({error:"資料の業務分けにはAI接続が必要です。読み取った原資料は保存されています。AIを設定してから再試行できます。"},{status:409});
  try {
    const pages = record.document.units.filter(unit=>unit.image), pending = pages.filter(unit=>!unit.visualReading).slice(0,3);
    if (pending.length) {
      const images = await Promise.all(pending.map(unit=>repo.getSourceImage(body.projectId,body.documentId,unit.id)));
      if (images.some(image=>!image)) throw new Error("原ページの画像が見つかりません。");
      const readings = await readDocumentImagesWithAI(record.document,images.filter(image=>image!==null),request.signal);
      const document={...record.document,units:record.document.units.map(unit=>({...unit,...(readings.find(reading=>reading.unitId===unit.id)?{visualReading:readings.find(reading=>reading.unitId===unit.id)!.reading}:{})}))};
      await repo.saveSourceDocument(body.projectId,document,record.bytes);
      return NextResponse.json({document,cached:false,progress:{stage:"pages",read:document.units.filter(unit=>unit.visualReading).length,total:pages.length}});
    }
    const {items,findings} = await readDocumentWorkItemsWithAI(record.document,request.signal);
    const config=getAIConfigurationStatus();
    const document = {...record.document, workItems: items, findings, analysis: {method: "ai" as const, provider: config.runtime ?? config.protocol, model: config.model, completedAt: new Date().toISOString()}};
    await repo.saveSourceDocument(body.projectId, document, record.bytes);
    return NextResponse.json({document,cached:false});
  } catch (error) {
    if (error instanceof Error && error.message.includes("取り消")) return NextResponse.json({error:error.message},{status:409});
    const value = safeAIError(error, "資料内の仕事を整理できませんでした。元資料と読めたページは保存されています。再試行できます。"); return NextResponse.json(value, {status:502});
  }
}
