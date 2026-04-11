type EnvKey =
  | "ELEVENLABS_API_KEY"
  | "ELEVENLABS_URL"
  | "ELEVENLABS_MODEL"
  | "PINECONE_API_KEY"
  | "PINECONE_INDEX_NAME"
  | "PINECONE_HOST"
  | "GEMINI_API_KEY"
  | "GOOGLE_GENAI_API_KEY"
  | "GEMINI_EMBED_MODEL"
  | "GEMINI_CHAT_MODEL"
  | "GEMINI_API_VERSION";

export function requireEnv(key: EnvKey): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

export function getGeminiApiKey(): string {
  return process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || "";
}

export function requireGeminiApiKey(): string {
  const key = getGeminiApiKey();
  if (!key) throw new Error("Missing env var: GOOGLE_GENAI_API_KEY (or GEMINI_API_KEY)");
  return key;
}

export function optionalEnv(key: EnvKey): string | undefined {
  return process.env[key] || undefined;
}

