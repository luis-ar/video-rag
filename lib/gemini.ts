import { GoogleGenAI } from "@google/genai";
import { optionalEnv, requireGeminiApiKey } from "@/lib/env";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  return cachedClient;
}

function extractEmbeddingVector(resp: unknown): number[] {
  const r =
    resp && typeof resp === "object" ? (resp as Record<string, unknown>) : null;
  if (!r) return [];

  const embedding = r["embedding"];
  if (embedding && typeof embedding === "object") {
    const e = embedding as Record<string, unknown>;
    const v = e["values"] ?? e["value"];
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  }

  const embeddings = r["embeddings"];
  if (
    Array.isArray(embeddings) &&
    embeddings[0] &&
    typeof embeddings[0] === "object"
  ) {
    const e0 = embeddings[0] as Record<string, unknown>;
    const v = e0["values"] ?? e0["value"];
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  }

  return [];
}

export async function embedText(
  text: string,
  opts?: { taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" },
) {
  const model = optionalEnv("GEMINI_EMBED_MODEL") || "gemini-embedding-001";
  const ai = getClient();

  const resp = await ai.models.embedContent({
    model,
    contents: text,
    config: opts?.taskType ? { taskType: opts.taskType } : undefined,
  });

  const vector = extractEmbeddingVector(resp);
  if (vector.length === 0)
    throw new Error("Gemini embeddings returned an empty vector");
  return { vector, model };
}

export async function generateAnswer(params: {
  question: string;
  contextChunks: Array<{ id: string; text: string }>;
}): Promise<{ text: string; model: string }> {
  const model = optionalEnv("GEMINI_CHAT_MODEL") || "gemini-2.0-flash";
  const ai = getClient();

  const context = params.contextChunks
    .map((c, i) => `[${i + 1}] (${c.id}) ${c.text}`)
    .join("\n\n");

  const prompt = [
    "You are a helpful assistant answering questions about a single video.",
    "Use ONLY the provided context to answer. If the answer isn't in the context, say you don't know.",
    "If the user asks for clips, highlights, or timestamps:",
    "  - Analyze the provided context, find the most important/relevant moments.",
    "  - IMPORTANT: Extract the numeric start and end times from the bracket notes like [8.0s - 15.2s] in the context.",
    "  - Output ONLY a JSON array of objects with the keys `start` (string/number), `end` (string/number), and `text` (string). Do not add markdown blocks.",
    "If the user asks a normal question, answer normally.",
    "",
    "Context:",
    context || "(no context returned)",
    "",
    `Question: ${params.question}`,
    "",
    "Answer:",
  ].join("\n");

  const resp = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  let text = "";
  const respObj =
    resp && typeof resp === "object"
      ? (resp as unknown as Record<string, unknown>)
      : null;
  const directText = respObj?.["text"];
  if (typeof directText === "function") text = String(directText());

  if (!text) {
    const response = respObj?.["response"];
    if (response && typeof response === "object") {
      const r = response as Record<string, unknown>;
      const responseText = r["text"];
      if (typeof responseText === "function") text = String(responseText());
    }
  }

  if (!text) {
    const candidates = respObj?.["candidates"];
    if (
      Array.isArray(candidates) &&
      candidates[0] &&
      typeof candidates[0] === "object"
    ) {
      const c0 = candidates[0] as Record<string, unknown>;
      const content = c0["content"];
      if (content && typeof content === "object") {
        const contentObj = content as Record<string, unknown>;
        const parts = contentObj["parts"];
        if (Array.isArray(parts)) {
          text = parts
            .map((p) => {
              if (!p || typeof p !== "object") return "";
              const po = p as Record<string, unknown>;
              return typeof po["text"] === "string" ? po["text"] : "";
            })
            .join("");
        }
      }
    }
  }

  const clean = String(text || "").trim();
  if (!clean) throw new Error("Gemini generation returned empty text");
  return { text: clean, model };
}
