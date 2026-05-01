This is a [Next.js](https://nextjs.org) project that demonstrates **video indexing + RAG (retrieval augmented generation)** using:

- **ElevenLabs** for speech-to-text transcription
- **Gemini** for embeddings + answer generation
- **Pinecone** for vector storage + semantic search

## Getting Started

### 1) Configure environment variables

Copy `.env.example` to `.env` and fill in keys:

```bash
cp .env.example .env
```

You must also create a Pinecone index and set `PINECONE_INDEX_NAME`.
The index dimension must match your embedding model output dimension.

### 2) Run the dev server

Run:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### How it works

#### Phase 1 — Ingestion (only once per video)

1. **Upload**: User uploads a video (stored in Cloudflare R2).
2. **Transcription**: Backend transcribes audio with **ElevenLabs** (word-level timestamps).
3. **Visual Analysis**: Video is sent to **Gemini 2.0 Flash** to extract chronological visual actions (e.g., "Person sits down at [5s-8s]").
4. **Multimodal Indexing**: Both transcript chunks and visual description chunks are embedded using Gemini and indexed in **Pinecone**.

Result: ✅ Video indexed with full visual and audio awareness.

#### Phase 2 — Query (multiple times)

1. **Retrieval**: User asks a question; Pinecone returns the most relevant visual and transcript chunks.
2. **Reasoning**: Gemini answers using these chunks + the original video file as context.
3. **Clipping**: The UI plays specific segments of the video based on the timestamps found by Gemini.

Result: ✅ Accurate responses grounded in what was said *and* seen.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
