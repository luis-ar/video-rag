import { NextResponse } from "next/server";
import { chunkText, chunkWords, parseVisualChunks } from "@/lib/chunking";
import { transcribeWithElevenLabs } from "@/lib/elevenlabs";
import {
  embedText,
  batchEmbedText,
  uploadToGemini,
  waitForGeminiFile,
  analyzeVideoActions,
} from "@/lib/gemini";
import { upsertVectors } from "@/lib/pinecone";
import { uploadFile } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const videoUrl = body.videoUrl;
    const videoId = body.videoId || crypto.randomUUID();
    const languageCode = body.languageCode;

    if (!videoUrl) {
      return NextResponse.json(
        { error: "Missing `videoUrl` in request body" },
        { status: 400 },
      );
    }

    console.log(
      `[Ingest] Analyzing video from URL: ${videoUrl} (videoId: ${videoId})`,
    );

    // 1. "Analyze everything using the URL"
    // We fetch from the URL to perform the transcription/analysis.
    const urlResponse = await fetch(videoUrl);
    if (!urlResponse.ok)
      throw new Error(
        `Could not fetch video from R2 for analysis: ${urlResponse.statusText}`,
      );
    const videoBlob = await urlResponse.blob();
    const fileName = videoUrl.split("/").pop() || "video.mp4";
    const videoFileForAnalysis = new File([videoBlob], fileName, {
      type: urlResponse.headers.get("content-type") || "video/mp4",
    });

    // 1. Parallelize Transcription and Gemini Processing (Upload + Analysis)
    console.log(`[Ingest] Starting transcription and Gemini processing in parallel...`);
    const [transcriptionResult, visualDescription] = await Promise.all([
      transcribeWithElevenLabs({
        file: videoFileForAnalysis,
        languageCode,
      }),
      (async () => {
        const uri = await uploadToGemini(videoBlob, fileName);
        await waitForGeminiFile(uri);
        console.log(`[Ingest] Gemini file active. Starting visual analysis...`);
        return analyzeVideoActions(uri, videoBlob, fileName);
      })(),
    ]);

    const { text: transcript, words } = transcriptionResult;
    console.log(`[Ingest] Transcription and Gemini analysis completed.`);
    
    const visualChunks = parseVisualChunks(visualDescription);
    console.log(`[Ingest] Extracted ${visualChunks.length} visual chunks.`);

    const transcriptChunks =
      words && words.length > 0
        ? chunkWords(words, { chunkSize: 900, overlap: 150 })
        : (chunkText(transcript, { chunkSize: 900, overlap: 150 }) as any[]);

    const allChunks = [
      ...transcriptChunks.map((c) => ({ ...c, type: "transcript" })),
      ...visualChunks.map((c) => ({ ...c, type: "visual" })),
    ];

    console.log(allChunks);

    if (allChunks.length === 0) {
      return NextResponse.json(
        { error: "No content (transcript or visual) produced chunks" },
        { status: 400 },
      );
    }

    console.log(`[Ingest] Generating embeddings for ${allChunks.length} chunks...`);
    const metadataTexts = allChunks.map((chunk) => {
      const isWordOrVisual = "start" in chunk;
      return isWordOrVisual
        ? `[${chunk.start.toFixed(1)}s - ${chunk.end.toFixed(1)}s] ${chunk.text}`
        : chunk.text;
    });

    const { vectors: embeddingVectors } = await batchEmbedText(metadataTexts, {
      taskType: "RETRIEVAL_DOCUMENT",
    });

    const vectors = allChunks.map((chunk, i) => {
      const isWordOrVisual = "start" in chunk;
      const metadataText = metadataTexts[i];

      return {
        id: `${videoId}:${i}`,
        values: embeddingVectors[i],
        metadata: {
          videoId,
          videoUrl,
          chunkIndex: i,
          text: metadataText,
          sourceFileName: fileName,
          contentType: chunk.type,
          ...(isWordOrVisual ? { start: chunk.start, end: chunk.end } : {}),
        },
      };
    });

    const batchSize = 50;
    for (let i = 0; i < vectors.length; i += batchSize) {
      await upsertVectors({
        namespace: videoId,
        vectors: vectors.slice(i, i + batchSize),
      });
    }

    return NextResponse.json({
      ok: true,
      videoId,
      videoUrl,
      transcriptChars: transcript.length,
      chunkCount: allChunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Ingest Error] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
