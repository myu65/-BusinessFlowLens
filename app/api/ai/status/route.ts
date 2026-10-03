import { NextResponse } from "next/server";
import { getAIConfigurationStatus } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  // Configuration presence is not proof of a completed inference request.
  return NextResponse.json(getAIConfigurationStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
