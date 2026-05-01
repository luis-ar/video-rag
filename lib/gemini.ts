import { GoogleGenAI } from "@google/genai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { optionalEnv, requireGeminiApiKey } from "@/lib/env";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  return cachedClient;
}

function extractEmbeddingVector(resp: unknown): number[] {
  const r = resp && typeof resp === "object" ? (resp as Record<string, unknown>) : null;
  if (!r) return [];

  // Single result format
  const embedding = r["embedding"];
  if (embedding && typeof embedding === "object") {
    const e = embedding as Record<string, unknown>;
    const v = e["values"] ?? e["value"];
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  }

  // Batch result format (or alternate single)
  const embeddings = r["embeddings"];
  if (Array.isArray(embeddings) && embeddings[0] && typeof embeddings[0] === "object") {
    const e0 = embeddings[0] as Record<string, unknown>;
    const v = e0["values"] ?? e0["value"];
    if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  }

  return [];
}

function extractEmbeddingVectors(resp: unknown): number[][] {
  const r = resp && typeof resp === "object" ? (resp as Record<string, unknown>) : null;
  if (!r) return [];

  const embeddings = r["embeddings"];
  if (Array.isArray(embeddings)) {
    return embeddings.map((e: any) => {
      const v = e["values"] ?? e["value"];
      return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
    });
  }

  const single = extractEmbeddingVector(resp);
  return single.length > 0 ? [single] : [];
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

export async function batchEmbedText(
  texts: string[],
  opts?: { taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" },
) {
  const model = optionalEnv("GEMINI_EMBED_MODEL") || "gemini-embedding-001";
  const ai = getClient();

  // The @google/genai SDK supports passing multiple strings in contents for models that support it
  // For models like gemini-embedding-001, we might need to use a specific batching pattern 
  // but many modern Gemini models support array of contents.
  const resp = await ai.models.embedContent({
    model,
    contents: texts,
    config: opts?.taskType ? { taskType: opts.taskType } : undefined,
  });

  const vectors = extractEmbeddingVectors(resp);
  if (vectors.length === 0)
    throw new Error("Gemini batch embeddings returned no vectors");
  return { vectors, model };
}

export async function uploadToGemini(
  blob: Blob,
  fileName: string,
): Promise<string> {
  const apiKey = requireGeminiApiKey();
  const fileManager = new GoogleAIFileManager(apiKey);

  // Write blob to a temp file
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `${crypto.randomUUID()}-${fileName}`);
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);

  try {
    const mimeType = blob.type || "video/mp4";
    const uploadResult = await fileManager.uploadFile(tempPath, {
      mimeType,
      displayName: fileName,
    });

    return uploadResult.file.uri;
  } finally {
    // Cleanup
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

export async function waitForGeminiFile(fileUri: string) {
  const apiKey = requireGeminiApiKey();
  const fileManager = new GoogleAIFileManager(apiKey);
  const name = fileUri.split("/").pop() || "";

  let file = await fileManager.getFile(name);
  while (file.state === FileState.PROCESSING) {
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    file = await fileManager.getFile(name);
  }

  if (file.state !== FileState.ACTIVE) {
    throw new Error(`File ${file.uri} failed to process: ${file.state}`);
  }
}

const commandCache: Record<string, boolean> = {};

function isCommandAvailable(cmd: string): boolean {
  if (cmd in commandCache) return commandCache[cmd];
  try {
    execSync(`${cmd} -version`, { stdio: "ignore" });
    commandCache[cmd] = true;
  } catch {
    commandCache[cmd] = false;
  }
  return commandCache[cmd];
}

function getVideoDuration(inputPath: string): number {
  try {
    if (!isCommandAvailable("ffprobe")) {
      return 0;
    }
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
    const duration = execSync(cmd).toString().trim();
    return parseFloat(duration);
  } catch (err) {
    console.error("Error getting video duration via ffprobe:", err);
    return 0;
  }
}

function extractSegment(inputPath: string, startTime: number, duration: number, outputPath: string) {
  try {
    if (!isCommandAvailable("ffmpeg")) {
      throw new Error("ffmpeg not available");
    }
    const cmd = `ffmpeg -y -ss ${startTime} -i "${inputPath}" -t ${duration} -c copy "${outputPath}"`;
    execSync(cmd, { stdio: "ignore" });
  } catch (err) {
    console.error(`Error extracting segment at ${startTime}:`, err);
    throw err;
  }
}

export async function analyzeVideoActions(fileUri: string, blob?: Blob, fileName?: string): Promise<string> {
  const model = optionalEnv("GEMINI_CHAT_MODEL") || "gemini-2.5-flash";
  const ai = getClient();
  const apiKey = requireGeminiApiKey();
  const fileManager = new GoogleAIFileManager(apiKey);

  const segmentSize = 300; // 5 minutes

  // Get duration from Gemini metadata first (most reliable on Vercel)
  const name = fileUri.split("/").pop() || "";
  const file = await fileManager.getFile(name);
  let duration = file.videoMetadata?.videoDuration ? parseFloat(file.videoMetadata.videoDuration) : 0;
  
  console.log(`[Gemini] Metadata duration: ${duration}s`);

  // If blob is provided AND ffmpeg is available, we can try to parallelize
  if (blob && fileName && isCommandAvailable("ffmpeg")) {
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `${crypto.randomUUID()}-${fileName}`);
    const buffer = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);

    // Backup: try local probe if metadata failed
    if (duration === 0) {
      duration = getVideoDuration(inputPath);
      console.log(`[Gemini] Probed duration: ${duration}s`);
    }

    if (duration > segmentSize * 1.2) { 
      console.log(`[Gemini] Parallelizing analysis into ${Math.ceil(duration / segmentSize)} segments...`);
      const segmentPromises: Promise<string>[] = [];

      for (let start = 0; start < duration; start += segmentSize) {
        const segmentDuration = Math.min(segmentSize, duration - start);
        const segmentPath = path.join(tempDir, `${crypto.randomUUID()}-seg-${start}.mp4`);
        
        const currentStart = start; // Closure
        segmentPromises.push((async () => {
          try {
            extractSegment(inputPath, currentStart, segmentDuration, segmentPath);
            
            // Upload segment
            const uploadResult = await fileManager.uploadFile(segmentPath, {
              mimeType: "video/mp4",
              displayName: `${fileName}-seg-${currentStart}`,
            });
            await waitForGeminiFile(uploadResult.file.uri);

            // Analyze segment
            const prompt = `
              Analyze this video segment (from ${currentStart}s to ${currentStart + segmentDuration}s) and provide a detailed chronological description of the actions.
              IMPORTANT: Use absolute timestamps based on the offset of ${currentStart}s.
              Example: if something happens 5s into this clip, write [${currentStart + 5}.0s - ...].
              
              For every significant change or action, provide a timestamp range in the format [start_s - end_s] followed by a description.
            `;

            const resp = await ai.models.generateContent({
              model,
              contents: [{
                role: "user",
                parts: [
                  { fileData: { fileUri: uploadResult.file.uri, mimeType: "video/mp4" } },
                  { text: prompt }
                ]
              }],
            });

            const text = (resp as any)?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
            
            // Cleanup segment file
            if (fs.existsSync(segmentPath)) fs.unlinkSync(segmentPath);
            
            return text;
          } catch (err) {
            console.error(`Error analyzing segment ${currentStart}:`, err);
            return "";
          }
        })());
      }

      const results = await Promise.all(segmentPromises);
      fs.unlinkSync(inputPath);
      return results.join("\n");
    }
    fs.unlinkSync(inputPath);
  }

  // Fallback to single analysis if short or parallelization fails/skipped
  const isLongVideo = duration > 900; // 15 minutes
  const prompt = isLongVideo
    ? `
    This is a long video. Provide a concise chronological summary of the most significant visual scenes, key actions, and major behavior changes. 
    Focus on major transitions and important events.
    For every significant moment, provide a timestamp range in the format [start_s - end_s] followed by a description.
    Aim for 15-30 high-quality chunks total.
    `
    : `
    Analyze this video and provide a detailed chronological description of the actions, visual scenes, and people's behaviors. 
    For every significant change or action, provide a timestamp range in the format [start_s - end_s] followed by a description.
    Example:
    [0.0s - 5.2s] A person in a blue shirt walks into the room and sits at a desk.
    [5.2s - 12.0s] The person starts typing on a laptop and looks at the camera.
    
    Be specific about what is seen.
    `;

  const resp = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri, mimeType: "video/mp4" } },
          { text: prompt },
        ],
      },
    ],
  });

  let text = "";
  const candidates = (resp as any)?.candidates;
  if (candidates?.[0]?.content?.parts) {
    text = candidates[0].content.parts.map((p: any) => p.text || "").join("");
  }

  if (!text) throw new Error("Gemini failed to extract video actions.");
  return text;
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
    "The provided context contains chunks from both the transcript (what is said) and visual analysis (what is seen). Chunks starting with [Visual] are visual descriptions.",
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
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
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
