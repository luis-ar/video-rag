import { requireEnv } from "@/lib/env";

export type ElevenLabsWord = {
  text: string;
  start: number;
  end: number;
  type?: string;
};

type ElevenLabsTranscription = {
  text?: string;
  transcript?: string;
  words?: ElevenLabsWord[];
};

export async function transcribeWithElevenLabs(params: {
  file: File;
  modelId?: string;
  languageCode?: string;
  diarize?: boolean;
}): Promise<{ text: string; words: ElevenLabsWord[] }> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const baseUrl = process.env.ELEVENLABS_URL || "https://api.elevenlabs.io";
  const modelId = params.modelId || process.env.ELEVENLABS_MODEL || "scribe_v2";

  const form = new FormData();
  form.append("file", params.file, params.file.name);
  form.append("model_id", modelId);
  form.append("timestamps_granularity", "word");
  if (params.languageCode) form.append("language_code", params.languageCode);
  if (typeof params.diarize === "boolean") form.append("diarize", String(params.diarize));

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/speech-to-text`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STT failed (${res.status}): ${body || res.statusText}`);
  }

  const json = (await res.json()) as ElevenLabsTranscription;
  const text = (json.text || json.transcript || "").trim();
  if (!text) throw new Error("ElevenLabs STT returned empty transcript");
  return { text, words: json.words || [] };
}

