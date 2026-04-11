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

1. User uploads a video/audio file (UI posts `multipart/form-data` to `POST /api/ingest`)
2. Backend transcribes with ElevenLabs
3. Transcript is chunked
4. Gemini generates embeddings per chunk
5. Vectors are upserted into Pinecone under a namespace = `videoId`

Result: ✅ Video indexed

#### Phase 2 — Query (multiple times)

1. User asks a question (UI posts JSON to `POST /api/query`)
2. Gemini embeds the question
3. Pinecone returns the most relevant transcript chunks
4. Gemini answers using retrieved chunks as context (RAG)

Result: ✅ Response grounded in the video

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
