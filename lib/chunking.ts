import { ElevenLabsWord } from "./elevenlabs";

export type TextChunk = {
  index: number;
  text: string;
};

export type WordTextChunk = {
  index: number;
  text: string;
  start: number;
  end: number;
};

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function chunkText(
  raw: string,
  {
    chunkSize = 900,
    overlap = 150,
  }: {
    chunkSize?: number;
    overlap?: number;
  } = {},
): TextChunk[] {
  const text = normalizeWhitespace(raw);
  if (!text) return [];

  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    const slice = text.slice(start, end).trim();
    if (slice) chunks.push({ index: chunks.length, text: slice });
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

export function chunkWords(
  words: ElevenLabsWord[],
  {
    chunkSize = 900,
    overlap = 150,
  }: {
    chunkSize?: number;
    overlap?: number;
  } = {},
): WordTextChunk[] {
  if (words.length === 0) return [];

  const chunks: WordTextChunk[] = [];
  let startIndex = 0;

  while (startIndex < words.length) {
    let currentLength = 0;
    let endIndex = startIndex;

    while (endIndex < words.length) {
      const wordLen = words[endIndex].text.length + (endIndex > startIndex ? 1 : 0);
      if (currentLength + wordLen > chunkSize && endIndex > startIndex) {
        break;
      }
      currentLength += wordLen;
      endIndex++;
    }

    const chunkWords = words.slice(startIndex, endIndex);
    const text = chunkWords.map((w) => w.text).join(" ").trim();
    if (text) {
      chunks.push({
        index: chunks.length,
        text,
        start: chunkWords[0].start,
        end: chunkWords[chunkWords.length - 1].end,
      });
    }

    if (endIndex >= words.length) break;

    let overlapStartIndex = endIndex - 1;
    let overlapLength = words[overlapStartIndex].text.length;

    while (overlapStartIndex > startIndex) {
      const wordLen = words[overlapStartIndex - 1].text.length + 1;
      if (overlapLength + wordLen > overlap) {
        break;
      }
      overlapLength += wordLen;
      overlapStartIndex--;
    }

    startIndex = overlapStartIndex > startIndex ? overlapStartIndex : endIndex;
  }

  return chunks;
}

