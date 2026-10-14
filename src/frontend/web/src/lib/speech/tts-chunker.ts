import {
  endsInsideAudioTag,
  stripAudioTags,
} from "@animama/product-ui/audio-tags";

export type TtsChunkingConfig = {
  minSentenceChars: number;
  maxChunkChars: number;
  minIdleFlushChars: number;
  idleFlushMs: number;
};

export const TTS_CHUNKING_DEFAULTS: TtsChunkingConfig = {
  minSentenceChars: 24,
  maxChunkChars: 140,
  minIdleFlushChars: 36,
  idleFlushMs: 700,
};

export type TtsChunkBoundaryType = "sentence" | "length" | "idle" | "final";

export type TtsChunkCandidate = {
  text: string;
  boundaryType: TtsChunkBoundaryType;
  isExclamation: boolean;
  wordCount: number;
};

export type TtsChunkRecord = TtsChunkCandidate & {
  runId: string;
  chunkId: string;
  index: number;
  wordStartIndex: number;
  wordEndIndex: number;
};

type ReadyChunkCandidatesResult = {
  chunks: TtsChunkCandidate[];
  remaining: string;
};

type IdleChunkResult = {
  chunk: string | null;
  remaining: string;
};

type IdleChunkCandidateResult = {
  chunk: TtsChunkCandidate | null;
  remaining: string;
};

function normalizeChunk(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeLeadingWhitespace(text: string): string {
  return text.replace(/^\s+/, "");
}

// Japanese and Chinese end sentences with full-width marks and no following space.
function isSentenceBoundaryChar(char: string): boolean {
  return /[.!?;\n。！？]/.test(char);
}

// Closing quotes and brackets (ASCII and full-width) and spaces stay with the sentence.
function isBoundaryContinuationChar(char: string): boolean {
  return /["')\]}」』”’）】]/.test(char) || /\s/.test(char);
}

export function countTtsChunkWords(text: string): number {
  return text.match(/[A-Za-z0-9']+/g)?.length ?? 0;
}

/** Whether the chunk's closing run of marks includes `!` ("Wow!", "Really?!"). */
export function isExclamationTtsChunk(text: string): boolean {
  return /![\s"')\]}!?.]*$/.test(text.trim());
}

function createChunkCandidate(
  text: string,
  boundaryType: TtsChunkBoundaryType,
): TtsChunkCandidate | null {
  const normalized = normalizeChunk(text);
  if (!normalized) return null;
  return {
    text: normalized,
    boundaryType,
    isExclamation: isExclamationTtsChunk(normalized),
    // Tags are never spoken as words, so gestures and lip-sync count without them.
    wordCount: countTtsChunkWords(stripAudioTags(normalized)),
  };
}

function findSentenceBoundaryEnd(
  text: string,
  minSentenceChars: number,
): number {
  const minIndex = Math.max(0, minSentenceChars - 1);
  for (let i = minIndex; i < text.length; i++) {
    if (!isSentenceBoundaryChar(text[i])) continue;
    // An ASCII mark inside a number or word ("$5.99", "animama.ai") ends nothing.
    if (/[.!?;]/.test(text[i]) && /[\p{L}\p{N}]/u.test(text[i + 1] ?? ""))
      continue;
    // A mark inside an audio tag ("[sighs. long pause]") ends nothing.
    if (endsInsideAudioTag(text.slice(0, i + 1))) continue;
    let end = i + 1;
    // A line break ends the sentence like the space after a mark.
    let sawSpace = /\s/.test(text[i]);
    while (end < text.length) {
      const char = text[end];
      // A run of marks ("?!", "！？", "...") stays with its sentence; after a
      // space, a mark starts the next one (".NET").
      if (
        !isBoundaryContinuationChar(char) &&
        (sawSpace || !isSentenceBoundaryChar(char))
      )
        break;
      if (/\s/.test(char)) sawSpace = true;
      end += 1;
    }
    return end;
  }
  return -1;
}

function splitAtWhitespaceOrLimit(
  text: string,
  maxChunkChars: number,
  minChunkChars: number,
  boundaryType: TtsChunkBoundaryType,
): IdleChunkResult {
  const normalizedInput = normalizeLeadingWhitespace(text);
  if (!normalizedInput) {
    return { chunk: null, remaining: "" };
  }
  // At the reply's end nothing can close an open bracket, so a final piece that
  // fits is sent whole.
  if (boundaryType === "final" && normalizedInput.length <= maxChunkChars) {
    const chunk = normalizeChunk(normalizedInput);
    return { chunk: chunk || null, remaining: "" };
  }

  let splitIndex = normalizedInput.length;
  if (normalizedInput.length > maxChunkChars) {
    const sliceEnd = Math.min(normalizedInput.length, maxChunkChars);
    const whitespaceIndex = normalizedInput.lastIndexOf(" ", sliceEnd);
    splitIndex = whitespaceIndex >= minChunkChars ? whitespaceIndex : sliceEnd;
  }
  // Split before an audio tag rather than inside it, so it reaches the voice
  // whole; a tag still being written waits in the remainder.
  const head = normalizedInput.slice(0, splitIndex);
  if (endsInsideAudioTag(head)) {
    const opener = Math.max(head.lastIndexOf("["), head.lastIndexOf("<"));
    if (opener > 0) splitIndex = opener;
    // An idle flush of a tag still being written waits for the rest of it.
    else if (boundaryType === "idle")
      return { chunk: null, remaining: normalizedInput };
  }
  if (splitIndex >= normalizedInput.length) {
    const chunk = normalizeChunk(normalizedInput);
    return { chunk: chunk || null, remaining: "" };
  }

  const rawChunk = normalizedInput.slice(0, splitIndex);
  const rawRemaining = normalizedInput.slice(splitIndex);
  const chunk = normalizeChunk(rawChunk);

  return {
    chunk: chunk || null,
    remaining: normalizeLeadingWhitespace(rawRemaining),
  };
}

function splitCandidateAtWhitespaceOrLimit(
  text: string,
  maxChunkChars: number,
  minChunkChars: number,
  boundaryType: TtsChunkBoundaryType,
): IdleChunkCandidateResult {
  const { chunk, remaining } = splitAtWhitespaceOrLimit(
    text,
    maxChunkChars,
    minChunkChars,
    boundaryType,
  );
  return {
    chunk: chunk ? createChunkCandidate(chunk, boundaryType) : null,
    remaining,
  };
}

export function extractReadyTtsChunkCandidates(
  buffer: string,
  config: TtsChunkingConfig = TTS_CHUNKING_DEFAULTS,
): ReadyChunkCandidatesResult {
  let remaining = normalizeLeadingWhitespace(buffer);
  const chunks: TtsChunkCandidate[] = [];

  while (remaining.length > 0) {
    const sentenceEnd = findSentenceBoundaryEnd(
      remaining,
      config.minSentenceChars,
    );
    if (sentenceEnd < 0) break;

    const rawChunk = remaining.slice(0, sentenceEnd);
    const chunk = createChunkCandidate(rawChunk, "sentence");
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = normalizeLeadingWhitespace(remaining.slice(sentenceEnd));
  }

  while (remaining.length >= config.maxChunkChars) {
    const { chunk, remaining: nextRemaining } =
      splitCandidateAtWhitespaceOrLimit(
        remaining,
        config.maxChunkChars,
        config.minIdleFlushChars,
        "length",
      );
    if (!chunk) break;
    chunks.push(chunk);
    remaining = nextRemaining;
  }

  return { chunks, remaining };
}

export function takeIdleTtsChunkCandidate(
  buffer: string,
  config: TtsChunkingConfig = TTS_CHUNKING_DEFAULTS,
): IdleChunkCandidateResult {
  const normalizedInput = normalizeLeadingWhitespace(buffer);
  if (!normalizedInput) {
    return { chunk: null, remaining: "" };
  }
  if (normalizeChunk(normalizedInput).length < config.minIdleFlushChars) {
    return { chunk: null, remaining: normalizedInput };
  }
  return splitCandidateAtWhitespaceOrLimit(
    normalizedInput,
    config.maxChunkChars,
    config.minIdleFlushChars,
    "idle",
  );
}

export function flushRemainingTtsChunkCandidates(
  buffer: string,
  config: TtsChunkingConfig = TTS_CHUNKING_DEFAULTS,
): TtsChunkCandidate[] {
  const { chunks, remaining } = extractReadyTtsChunkCandidates(buffer, config);
  let trailing = normalizeLeadingWhitespace(remaining);
  const finalChunks = chunks.slice();

  while (trailing.length > 0) {
    const { chunk, remaining: nextRemaining } =
      splitCandidateAtWhitespaceOrLimit(
        trailing,
        config.maxChunkChars,
        1,
        "final",
      );
    if (!chunk) break;
    finalChunks.push(chunk);
    trailing = nextRemaining;
  }

  return finalChunks;
}

export function createTtsChunkRecords({
  runId,
  chunks,
  startIndex,
  wordStartIndex,
}: {
  runId: string;
  chunks: readonly TtsChunkCandidate[];
  startIndex: number;
  wordStartIndex: number;
}): TtsChunkRecord[] {
  let nextWordStartIndex = Math.max(0, Math.round(wordStartIndex));
  return chunks.map((chunk, offset) => {
    const index = Math.max(0, Math.round(startIndex)) + offset;
    const wordCount = Math.max(0, Math.round(chunk.wordCount));
    const record: TtsChunkRecord = {
      ...chunk,
      runId,
      chunkId: `${runId}:tts-chunk:${index}`,
      index,
      wordStartIndex: nextWordStartIndex,
      wordEndIndex: nextWordStartIndex + wordCount,
    };
    nextWordStartIndex = record.wordEndIndex;
    return record;
  });
}
