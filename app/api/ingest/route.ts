import { NextResponse } from "next/server";
import { chunkText, chunkWords } from "@/lib/chunking";
import { transcribeWithElevenLabs } from "@/lib/elevenlabs";
import { embedText } from "@/lib/gemini";
import { upsertVectors } from "@/lib/pinecone";
import { uploadFile } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const videoUrl = body.videoUrl;
    const videoId = body.videoId || crypto.randomUUID();
    const languageCode = body.languageCode;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing `videoUrl` in request body" }, { status: 400 });
    }

    console.log(`[Ingest] Analyzing video from URL: ${videoUrl} (videoId: ${videoId})`);

    // 1. "Analyze everything using the URL" 
    // We fetch from the URL to perform the transcription/analysis.
    const urlResponse = await fetch(videoUrl);
    if (!urlResponse.ok) throw new Error(`Could not fetch video from R2 for analysis: ${urlResponse.statusText}`);
    const videoBlob = await urlResponse.blob();
    const fileName = videoUrl.split("/").pop() || "video.mp4";
    const videoFileForAnalysis = new File([videoBlob], fileName, { type: urlResponse.headers.get("content-type") || "video/mp4" });

    const { text: transcript, words } = await transcribeWithElevenLabs({
      file: videoFileForAnalysis,
      languageCode,
    });

    const chunks = words && words.length > 0
      ? chunkWords(words, { chunkSize: 900, overlap: 150 })
      : (chunkText(transcript, { chunkSize: 900, overlap: 150 }) as any[]);

    if (chunks.length === 0) {
      return NextResponse.json({ error: "Transcript produced no chunks" }, { status: 400 });
    }

    const vectors: Array<{ id: string; values: number[]; metadata: Record<string, string | number | boolean | string[]> }> = [];
    for (const chunk of chunks) {
      const isWordChunk = "start" in chunk;
      const metadataText = isWordChunk 
        ? `[${chunk.start.toFixed(1)}s - ${chunk.end.toFixed(1)}s] ${chunk.text}`
        : chunk.text;
        
      const { vector } = await embedText(metadataText, { taskType: "RETRIEVAL_DOCUMENT" });
      vectors.push({
        id: `${videoId}:${chunk.index}`,
        values: vector,
        metadata: {
          videoId,
          videoUrl, // Store the R2 URL in metadata for session-less retrieval
          chunkIndex: chunk.index,
          text: metadataText,
          sourceFileName: fileName,
          ...(isWordChunk ? { start: chunk.start, end: chunk.end } : {}),
        },
      });
    }

    const batchSize = 50;
    for (let i = 0; i < vectors.length; i += batchSize) {
      await upsertVectors({ namespace: videoId, vectors: vectors.slice(i, i + batchSize) });
    }

    return NextResponse.json({
      ok: true,
      videoId,
      videoUrl,
      transcriptChars: transcript.length,
      chunkCount: chunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Ingest Error] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

