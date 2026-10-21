import { describe, expect, it } from "vitest";

import { detokenize, greedyRnnt, melChunk } from "./rnnt";

describe("melChunk", () => {
  // Three frames of two bins each.
  const frames = [
    Float32Array.of(1, 11),
    Float32Array.of(2, 12),
    Float32Array.of(3, 13),
  ];

  it("zero-fills frames before the start and past the available audio", () => {
    expect(Array.from(melChunk(frames, 2, -1, 5, false))).toEqual([
      0, 1, 2, 3, 0, 0, 11, 12, 13, 0,
    ]);
  });

  it("lays frames out time-major when asked", () => {
    expect(Array.from(melChunk(frames, 2, 1, 2, true))).toEqual([2, 12, 3, 13]);
  });
});

describe("greedyRnnt", () => {
  it("emits tokens until blank on each frame, with a per-frame cap", async () => {
    const blank = 3;
    // Frame 0 emits 1 then 2; frame 1 emits nothing; frame 2 would emit forever.
    const script: Record<number, number[]> = {
      0: [1, 2, blank],
      1: [blank],
      2: [0],
    };
    const emitted: number[] = [];
    const tokens = await greedyRnnt(
      3,
      blank,
      {
        joint: async (frame) => {
          const queue = script[frame];
          const next = queue.length > 1 ? queue.shift()! : queue[0];
          const scores = new Float32Array(4).fill(-10);
          scores[next] = 0;
          return scores;
        },
        emit: async (token) => {
          emitted.push(token);
        },
      },
      4,
    );

    expect(tokens).toEqual([1, 2, 0, 0, 0, 0]);
    expect(emitted).toEqual(tokens);
  });
});

describe("detokenize", () => {
  const tokens = [
    "<unk>",
    "▁Hello",
    ",",
    "▁world",
    "<ja-JP>",
    "こん",
    "にちは",
    "<blk>",
  ];

  it("joins pieces and drops special tokens", () => {
    expect(detokenize([1, 2, 3, 4, 7, 0], tokens)).toBe("Hello, world");
    expect(detokenize([5, 6, 4], tokens)).toBe("こんにちは");
  });
});
