"use client";

import { useMemo, useState, useEffect, useRef } from "react";

type IngestResult =
  | { ok: true; videoId: string; chunkCount: number; transcriptChars: number }
  | { error: string };

type QueryResult =
  | {
      ok: true;
      videoId: string;
      model: string;
      answer: string;
      matches: Array<{ id: string; score?: number; chunkIndex?: number }>;
    }
  | { error: string };

function ClipPlayer({ videoUrl, start, end }: { videoUrl: string; start: number; end: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && Number.isFinite(start)) {
      videoRef.current.currentTime = start;
    }
  }, [start]);

  return (
    <video
      ref={videoRef}
      src={`${videoUrl}#t=${Number.isFinite(start) ? start : 0},${Number.isFinite(end) ? end : 0}`}
      controls
      className="w-full rounded-lg bg-black/5 dark:bg-white/5"
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        
        if (v.currentTime >= end) {
          v.pause();
          v.currentTime = end;
        } else if (v.currentTime < start) {
          v.currentTime = start;
        }
      }}
    />
  );
}

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoId, setVideoId] = useState<string>("");
  const [isIndexing, setIsIndexing] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);

  const [question, setQuestion] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);

  const effectiveVideoId = useMemo(() => {
    if (ingestResult && "ok" in ingestResult && ingestResult.ok) return ingestResult.videoId;
    return videoId.trim();
  }, [ingestResult, videoId]);

  async function onIndexVideo(e: React.FormEvent) {
    e.preventDefault();
    setIngestResult(null);
    setQueryResult(null);

    if (!videoFile) {
      setIngestResult({ error: "Pick a video/audio file first." });
      return;
    }

    setIsIndexing(true);
    try {
      const form = new FormData();
      form.append("file", videoFile, videoFile.name);
      if (videoId.trim()) form.append("videoId", videoId.trim());

      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const json = (await res.json()) as IngestResult;
      if (!res.ok) throw new Error(("error" in json && json.error) || "Indexing failed");
      setIngestResult(json);
      if ("ok" in json && json.ok) {
        fetchVideos();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setIngestResult({ error: message });
    } finally {
      setIsIndexing(false);
    }
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    setQueryResult(null);

    if (!effectiveVideoId) {
      setQueryResult({ error: "Enter a videoId or index a video first." });
      return;
    }
    if (!question.trim()) {
      setQueryResult({ error: "Type a question first." });
      return;
    }

    setIsQuerying(true);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: effectiveVideoId, question: question.trim(), topK: 50 }),
      });
      const json = (await res.json()) as QueryResult;
      if (!res.ok) throw new Error(("error" in json && json.error) || "Query failed");
      setQueryResult(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setQueryResult({ error: message });
    } finally {
      setIsQuerying(false);
    }
  }

  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!videoFile) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  function parseSafeFloat(val: unknown): number {
    if (typeof val === "number") return Number.isFinite(val) ? val : 0;
    const str = String(val).replace(/[^0-9.]/g, '');
    const p = parseFloat(str);
    return Number.isFinite(p) ? p : 0;
  }

  const parsedClips = useMemo(() => {
    if (!queryResult || !("ok" in queryResult) || !queryResult.ok) return null;
    try {
      const match = queryResult.answer.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0 && "start" in parsed[0] && "end" in parsed[0]) {
          return parsed.map(c => ({
            start: parseSafeFloat(c.start),
            end: parseSafeFloat(c.end),
            text: String(c.text || ""),
          }));
        }
      }
    } catch {
      // Ignored
    }
    return null;
  }, [queryResult]);

  const [availableVideos, setAvailableVideos] = useState<Array<{ id: string; name: string }>>([]);

  async function fetchVideos() {
    try {
      const res = await fetch("/api/videos");
      const data = await res.json();
      if (data.ok && Array.isArray(data.videos)) {
        setAvailableVideos(data.videos);
      }
    } catch {
      // Ignored
    }
  }

  useEffect(() => {
    fetchVideos();
  }, []);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans text-zinc-950 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Video RAG (ElevenLabs → Gemini → Pinecone)</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Index a video once, then ask questions multiple times. All answers are grounded in retrieved transcript
            chunks.
          </p>
        </header>

        <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold">Phase 1 — Ingestion (only once per video)</h2>
          <form className="mt-4 flex flex-col gap-4" onSubmit={onIndexVideo}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Video/audio file</span>
              <input
                type="file"
                accept="video/*,audio/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="block w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">videoId (optional)</span>
              <input
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                placeholder="leave blank to auto-generate"
                className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              />
            </label>

            <button
              type="submit"
              disabled={isIndexing}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-black px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {isIndexing ? "Indexing…" : "Index video"}
            </button>
          </form>

          {ingestResult && (
            <div className="mt-4 rounded-xl border border-black/10 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-black">
              {"error" in ingestResult ? (
                <p className="text-red-600 dark:text-red-400">{ingestResult.error}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  <p>
                    <span className="font-medium">✅ Indexed.</span> videoId:{" "}
                    <span className="font-mono">{ingestResult.videoId}</span>
                  </p>
                  <p className="text-zinc-600 dark:text-zinc-400">
                    chunks: {ingestResult.chunkCount} · transcript chars: {ingestResult.transcriptChars}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold">Phase 2 — Query (repeat as needed)</h2>
          <form className="mt-4 flex flex-col gap-4" onSubmit={onAsk}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Video</span>
              <select
                value={effectiveVideoId}
                onChange={(e) => {
                  setVideoId(e.target.value);
                  setIngestResult(null);
                }}
                className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              >
                <option value="" disabled>-- Select an ingested video --</option>
                {effectiveVideoId && !availableVideos.some(v => v.id === effectiveVideoId) && (
                  <option value={effectiveVideoId}>{effectiveVideoId} - Just Uploaded</option>
                )}
                {availableVideos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id} - {v.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Question</span>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask something about the video…"
                rows={4}
                className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              />
            </label>

            <button
              type="submit"
              disabled={isQuerying}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-black px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {isQuerying ? "Searching…" : "Ask"}
            </button>
          </form>

          {queryResult && (
            <div className="mt-4 rounded-xl border border-black/10 bg-zinc-50 p-4 text-sm dark:border-white/10 dark:bg-black">
              {"error" in queryResult ? (
                <p className="text-red-600 dark:text-red-400">{queryResult.error}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="font-medium">Answer</p>
                    {parsedClips && videoUrl ? (
                      <div className="mt-4 flex flex-col gap-6">
                        {parsedClips.map((clip, i) => (
                          <div key={i} className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                            <ClipPlayer videoUrl={videoUrl} start={clip.start} end={clip.end} />
                            <p className="text-sm text-zinc-800 dark:text-zinc-200">{clip.text}</p>
                            <p className="text-xs font-mono text-zinc-500">
                              {clip.start}s - {clip.end}s
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{queryResult.answer}</p>
                    )}
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      model: {queryResult.model} · matches: {queryResult.matches.length}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">Retrieved chunks</p>
                    <ul className="mt-2 space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                      {queryResult.matches.map((m) => (
                        <li key={m.id} className="font-mono">
                          {m.id} {typeof m.score === "number" ? `(${m.score.toFixed(3)})` : ""}{" "}
                          {typeof m.chunkIndex === "number" ? `chunk=${m.chunkIndex}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
