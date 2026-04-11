import { NextResponse } from "next/server";
import { getAvailableVideos } from "@/lib/pinecone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const videos = await getAvailableVideos();
    return NextResponse.json({ ok: true, videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
