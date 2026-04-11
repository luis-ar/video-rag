import { NextResponse } from "next/server";
import { chunkText, chunkWords } from "@/lib/chunking";
import { transcribeWithElevenLabs } from "@/lib/elevenlabs";
import { embedText } from "@/lib/gemini";
import { upsertVectors } from "@/lib/pinecone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getString(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing `file` in multipart form-data" }, { status: 400 });
    }

    const videoId = getString(form, "videoId") || crypto.randomUUID();
    const languageCode = getString(form, "languageCode");

    const { text: transcript, words } = await transcribeWithElevenLabs({
      file,
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
          chunkIndex: chunk.index,
          text: metadataText,
          sourceFileName: file.name,
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
      transcriptChars: transcript.length,
      chunkCount: chunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

