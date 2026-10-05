import { NextResponse } from "next/server";
import { getBusinessFlowRepository } from "@/lib/storage";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json();
  if (typeof body.projectId !== "string" || typeof body.documentId !== "string" || !["active","withdrawn"].includes(body.state)) return NextResponse.json({error:"資料と操作を指定してください。"},{status:400});
  const document = await getBusinessFlowRepository().setSourceDocumentState(body.projectId,body.documentId,body.state);
  if (!document) return NextResponse.json({error:"元資料が見つかりません。"},{status:404});
  return NextResponse.json({document});
}
