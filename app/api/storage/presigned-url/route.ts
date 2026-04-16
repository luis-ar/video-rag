import { NextResponse } from "next/server";
import { createPresignedUploadUrl } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fileName = searchParams.get("fileName");
    const contentType = searchParams.get("contentType");
    let videoId = searchParams.get("videoId");

    if (!fileName || !contentType) {
      return NextResponse.json(
        { error: "Missing `fileName` or `contentType` query parameters" },
        { status: 400 }
      );
    }

    if (!videoId) {
      videoId = crypto.randomUUID();
    }

    const fileExtension = fileName.split(".").pop() || "mp4";
    const r2Key = `${videoId}.${fileExtension}`;

    const { presignedUrl, publicUrl } = await createPresignedUploadUrl(
      r2Key,
      contentType
    );

    return NextResponse.json({
      ok: true,
      presignedUrl,
      videoUrl: publicUrl,
      videoId,
      r2Key,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
