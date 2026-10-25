import { describe, expect, it } from "vitest";

import type { BenchClip, BenchClipResult } from "./bench-protocol";
import { withSetReference } from "./set-reference";

function clip(overrides: Partial<BenchClip>): BenchClip {
  return {
    set: "zh-Hans",
    id: "a.wav",
    language: "zh",
    url: "zh-Hans/a.wav",
    text: "这个软件里的鼠标",
    ...overrides,
  };
}

const result: BenchClipResult = {
  set: "zh-Hant",
  id: "a.wav",
  audioSeconds: 2,
  text: "說這群人著急",
  finalLatencyMs: 100,
  processingMs: 100,
  firstInterimMs: null,
  interimCount: 0,
  interimStops: 0,
};

describe("withSetReference", () => {
  it("converts a Simplified reference for a set scored in Traditional", async () => {
    const scored = await withSetReference(
      clip({ set: "zh-Hant", script: "Hant", referenceScript: "Hans" }),
      result,
    );

    expect(scored.reference).toBe("這個軟件裡的鼠標");
    expect(scored.text).toBe(result.text);
  });

  it("keeps the clip's own reference otherwise", async () => {
    expect(await withSetReference(clip({ script: "Hans" }), result)).toBe(
      result,
    );
    expect(
      await withSetReference(
        clip({ set: "yue", script: "Hant", text: "佢哋喺度" }),
        result,
      ),
    ).toBe(result);
  });
});
