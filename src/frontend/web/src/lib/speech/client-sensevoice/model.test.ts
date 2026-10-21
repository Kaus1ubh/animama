import { describe, expect, it } from "vitest";

import { decodeSenseVoiceLogits, parseTokenTable } from "./model";

/** One-hot logits for a frame sequence of token ids. */
function logits(ids: number[], vocab: number): Float32Array {
  const values = new Float32Array(ids.length * vocab).fill(-5);
  ids.forEach((id, frame) => {
    values[frame * vocab + id] = 5;
  });
  return values;
}

const tokens = [
  "<unk>",
  "<|ja|>",
  "<|NEUTRAL|>",
  "<|Speech|>",
  "<|withitn|>",
  "▁Hello",
  "▁world",
  "こん",
  "にちは",
  "▁は",
  "▁안녕",
  "▁하세요",
  "。",
  ".",
];

describe("decodeSenseVoiceLogits", () => {
  it("collapses repeats, drops blanks and strips the tag frames", () => {
    const frames = [1, 2, 3, 4, 7, 7, 0, 8, 8];
    expect(
      decodeSenseVoiceLogits(
        logits(frames, tokens.length),
        frames.length,
        tokens.length,
        tokens,
      ),
    ).toBe("こんにちは");
  });

  it("keeps a repeated token separated by a blank and maps ▁ to spaces", () => {
    const frames = [5, 0, 5, 6];
    expect(
      decodeSenseVoiceLogits(
        logits(frames, tokens.length),
        frames.length,
        tokens.length,
        tokens,
      ),
    ).toBe("Hello Hello world");
  });

  it("writes Japanese and Chinese without the word-start spaces, unlike Korean", () => {
    for (const [frames, text] of [
      [[7, 8, 9], "こんにちはは"],
      [[10, 11], "안녕 하세요"],
      [[5, 7], "Helloこん"],
      [[7, 6], "こんworld"],
    ] as const)
      expect(
        decodeSenseVoiceLogits(
          logits([...frames], tokens.length),
          frames.length,
          tokens.length,
          tokens,
        ),
      ).toBe(text);
  });

  it("yields no text for a window of punctuation alone", () => {
    const decode = (frames: number[]) =>
      decodeSenseVoiceLogits(
        logits(frames, tokens.length),
        frames.length,
        tokens.length,
        tokens,
      );
    expect(decode([1, 13])).toBe("");
    expect(decode([12, 0, 13])).toBe("");
    expect(decode([7, 12])).toBe("こん。");
  });

  it("removes tags wherever they appear, even mid-utterance", () => {
    const frames = [7, 3, 8];
    expect(
      decodeSenseVoiceLogits(
        logits(frames, tokens.length),
        frames.length,
        tokens.length,
        tokens,
      ),
    ).toBe("こんにちは");
  });
});

describe("parseTokenTable", () => {
  it("maps ids to pieces, splitting on the last space", () => {
    expect(parseTokenTable("<unk> 0\n▁a b 2\n▁c 1\n")).toEqual([
      "<unk>",
      "▁c",
      "▁a b",
    ]);
  });
});
