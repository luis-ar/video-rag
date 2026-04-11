import { NextResponse } from "next/server";
import { embedText, generateAnswer } from "@/lib/gemini";
import { queryVectors } from "@/lib/pinecone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueryBody = {
  videoId?: string;
  question?: string;
  topK?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as QueryBody;
    const videoId = (body.videoId || "").trim();
    const question = (body.question || "").trim();
    const topK = typeof body.topK === "number" && body.topK > 0 ? Math.min(body.topK, 100) : 30;

    if (!videoId) return NextResponse.json({ error: "Missing `videoId`" }, { status: 400 });
    if (!question) return NextResponse.json({ error: "Missing `question`" }, { status: 400 });

    const { vector: qVec } = await embedText(question, { taskType: "RETRIEVAL_QUERY" });
    const matches = await queryVectors({ namespace: videoId, vector: qVec, topK });

    const contextChunks = matches
      .map((m) => ({
        id: m.id,
        text: typeof m.metadata?.text === "string" ? m.metadata.text : "",
      }))
      .filter((c) => c.text.trim().length > 0);

    const { text: answer, model } = await generateAnswer({
      question,
      contextChunks,
    });

    return NextResponse.json({
      ok: true,
      videoId,
      model,
      answer,
      matches: matches.map((m) => ({
        id: m.id,
        score: m.score,
        chunkIndex: typeof m.metadata?.chunkIndex === "number" ? m.metadata.chunkIndex : undefined,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}