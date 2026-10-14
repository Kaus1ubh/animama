import { describe, expect, it } from "vitest";

import {
  extractReadyTtsChunkCandidates,
  flushRemainingTtsChunkCandidates,
  isExclamationTtsChunk,
  takeIdleTtsChunkCandidate,
  TTS_CHUNKING_DEFAULTS,
} from "./tts-chunker";

function readyChunks(buffer: string, minSentenceChars = 1) {
  const { chunks, remaining } = extractReadyTtsChunkCandidates(buffer, {
    ...TTS_CHUNKING_DEFAULTS,
    minSentenceChars,
  });
  return { chunks: chunks.map((chunk) => chunk.text), remaining };
}

describe("extractReadyTtsChunkCandidates", () => {
  it("ends Japanese and Chinese sentences at full-width marks", () => {
    expect(readyChunks("好きな季節は秋です。澄んだ空気が")).toEqual({
      chunks: ["好きな季節は秋です。"],
      remaining: "澄んだ空気が",
    });
    expect(readyChunks("你好！今天怎么样？很好")).toEqual({
      chunks: ["你好！", "今天怎么样？"],
      remaining: "很好",
    });
  });

  it("keeps closing brackets and quotes with their sentence", () => {
    expect(readyChunks("「おはよう。」と言った")).toEqual({
      chunks: ["「おはよう。」"],
      remaining: "と言った",
    });
  });

  it("applies the default minimum before a Japanese chunk ends", () => {
    // The first sentence is shorter than the minimum, so the chunk runs to the next end.
    const { chunks } = extractReadyTtsChunkCandidates(
      "好きな季節は秋です。澄んだ空気がとても心地いいですね。温かい",
    );
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "好きな季節は秋です。澄んだ空気がとても心地いいですね。",
    ]);
  });

  it("keeps a run of marks with its sentence", () => {
    expect(readyChunks("本当に信じられない！？すごいですね。")).toEqual({
      chunks: ["本当に信じられない！？", "すごいですね。"],
      remaining: "",
    });
    expect(readyChunks("You did that?! Wow... Nice")).toEqual({
      chunks: ["You did that?!", "Wow..."],
      remaining: "Nice",
    });
  });

  it("leaves a mark after the space to the next sentence", () => {
    const { chunks, remaining } = extractReadyTtsChunkCandidates(
      "I have used it for many years. .NET is my favorite framework. More",
    );
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "I have used it for many years.",
      ".NET is my favorite framework.",
    ]);
    expect(remaining).toBe("More");

    // A line break is the space before the next sentence's mark.
    expect(
      extractReadyTtsChunkCandidates(
        "Here is how I would rank them for you\n.NET is first on my list. More",
      ).chunks.map((chunk) => chunk.text),
    ).toEqual([
      "Here is how I would rank them for you",
      ".NET is first on my list.",
    ]);
  });

  it("flags a chunk whose closing run has an exclamation mark", () => {
    expect(isExclamationTtsChunk("You did that!?")).toBe(true);
    expect(isExclamationTtsChunk("You did that?!")).toBe(true);
    expect(isExclamationTtsChunk('She said "No!"')).toBe(true);
    expect(isExclamationTtsChunk("Really?")).toBe(false);
    expect(isExclamationTtsChunk("Wow! It works.")).toBe(false);
  });

  it("keeps a decimal point or a dot inside a word with its sentence", () => {
    expect(
      readyChunks("It costs $5.99 at 3:30 pm, see animama.ai. Then"),
    ).toEqual({
      chunks: ["It costs $5.99 at 3:30 pm, see animama.ai."],
      remaining: "Then",
    });
  });

  it("keeps English sentence ends unchanged", () => {
    expect(readyChunks("Hello there. How are you? Fine")).toEqual({
      chunks: ["Hello there.", "How are you?"],
      remaining: "Fine",
    });
  });
});

describe("audio tags", () => {
  it("never ends a sentence inside a tag", () => {
    expect(readyChunks("Well [sighs. long pause] okay. Next")).toEqual({
      chunks: ["Well [sighs. long pause] okay."],
      remaining: "Next",
    });
    expect(readyChunks("Hmm [sighs? softly] fine! More")).toEqual({
      chunks: ["Hmm [sighs? softly] fine!"],
      remaining: "More",
    });
  });

  it("waits for a tag that is still being written", () => {
    expect(readyChunks("Oh [gasps! wow")).toEqual({
      chunks: [],
      remaining: "Oh [gasps! wow",
    });
  });

  it("splits a long chunk before a tag, never inside it", () => {
    // The last space within 140 characters falls inside the tag.
    const words = "word ".repeat(25);
    const { chunks, remaining } = extractReadyTtsChunkCandidates(
      `${words}[whispering, very playfully] then more`,
      { ...TTS_CHUNKING_DEFAULTS, maxChunkChars: 140 },
    );
    expect(chunks.map((chunk) => chunk.text)).toEqual([words.trim()]);
    expect(remaining.startsWith("[whispering, very playfully]")).toBe(true);
  });

  it("does not let an idle flush cut a tag in half", () => {
    const { chunk, remaining } = takeIdleTtsChunkCandidate(
      "This is a long enough sentence so far [whispering, play",
    );
    expect(chunk?.text).toBe("This is a long enough sentence so far");
    expect(remaining).toBe("[whispering, play");
  });

  it("does not idle-flush a tag that starts the buffer and is still being written", () => {
    expect(
      takeIdleTtsChunkCandidate(
        "[whispering, softly and very playfully, gently",
      ),
    ).toEqual({
      chunk: null,
      remaining: "[whispering, softly and very playfully, gently",
    });
  });

  it("sends a reply's last piece whole when no later text can close its bracket", () => {
    expect(
      flushRemainingTtsChunkCandidates(
        "I think x<y and that is fine with me",
      ).map((chunk) => chunk.text),
    ).toEqual(["I think x<y and that is fine with me"]);
  });

  it("counts a chunk's words without its tags", () => {
    const { chunks } = extractReadyTtsChunkCandidates(
      "[laughs] That is so funny! ",
      { ...TTS_CHUNKING_DEFAULTS, minSentenceChars: 1 },
    );
    expect(chunks[0]?.wordCount).toBe(4);
  });

  it("flushes a finished reply without cutting its tags", () => {
    const words = "word ".repeat(26);
    expect(
      flushRemainingTtsChunkCandidates(`${words}[laughs softly] the end`).map(
        (chunk) => chunk.text,
      ),
    ).toEqual([words.trim(), "[laughs softly] the end"]);
  });
});
