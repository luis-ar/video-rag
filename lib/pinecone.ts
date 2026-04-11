import { Pinecone } from "@pinecone-database/pinecone";
import { optionalEnv, requireEnv } from "@/lib/env";

export type PineconeMatch = {
  id: string;
  score?: number;
  metadata?: PineconeMetadata;
};

export type PineconeMetadata = Record<string, string | number | boolean | string[]>;

let cachedIndex: ReturnType<Pinecone["index"]> | null = null;

function getIndex() {
  if (cachedIndex) return cachedIndex;
  const apiKey = requireEnv("PINECONE_API_KEY");
  const indexName = requireEnv("PINECONE_INDEX_NAME");
  const host = optionalEnv("PINECONE_HOST");
  const pc = new Pinecone({ apiKey });
  cachedIndex = host ? pc.index({ host }) : pc.index({ name: indexName });
  return cachedIndex;
}

export async function upsertVectors(params: {
  namespace: string;
  vectors: Array<{ id: string; values: number[]; metadata?: PineconeMetadata }>;
}) {
  const index = getIndex();
  const ns = index.namespace(params.namespace);
  await ns.upsert({
    records: params.vectors.map((v) => ({
      id: v.id,
      values: v.values,
      metadata: v.metadata,
    })),
  });
}

export async function queryVectors(params: {
  namespace: string;
  vector: number[];
  topK: number;
  filter?: Record<string, string | number | boolean | string[]>;
}): Promise<PineconeMatch[]> {
  const index = getIndex();
  const ns = index.namespace(params.namespace);
  const res = await ns.query({
    vector: params.vector,
    topK: params.topK,
    includeMetadata: true,
    filter: params.filter,
  });
  return (res.matches || []).map((m) => ({
    id: String(m.id),
    score: m.score,
    metadata: (m.metadata || undefined) as unknown as PineconeMetadata | undefined,
  }));
}

export async function getAvailableVideos(): Promise<Array<{ id: string; name: string }>> {
  const index = getIndex();
  const stats = await index.describeIndexStats();
  const namespaces = stats.namespaces || {};
  
  const videos: Array<{ id: string; name: string }> = [];
  
  for (const [ns] of Object.entries(namespaces)) {
    const nsObj = index.namespace(ns);
    try {
      const fetchRes = await nsObj.fetch({ ids: [`${ns}:0`] });
      let name = "Unknown Video";
      const record = fetchRes.records ? fetchRes.records[`${ns}:0`] : undefined;
      if (record && record.metadata) {
        name = String(record.metadata.sourceFileName || name);
      }
      videos.push({ id: ns, name });
    } catch {
      videos.push({ id: ns, name: "Unknown Video" });
    }
  }
  
  return videos;
}

