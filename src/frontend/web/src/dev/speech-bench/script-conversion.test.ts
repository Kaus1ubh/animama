import { describe, expect, it } from "vitest";

import type { BenchClip, BenchClipResult } from "./bench-protocol";
import { inSetScript } from "./script-conversion";

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
  set: "zh-Hans",
  id: "a.wav",
  audioSeconds: 2,
  text: "说这群人着急",
  finalLatencyMs: 100,
  processingMs: 100,
  firstInterimMs: null,
  interimCount: 0,
  interimStops: 0,
};

describe("inSetScript", () => {
  it("leaves a Simplified set unchanged", () => {
    expect(inSetScript(clip({ script: "Hans" }), result)).toBe(result);
  });

  it("converts the output and a Simplified reference for zh-Hant", () => {
    const converted = inSetScript(
      clip({ set: "zh-Hant", script: "Hant", referenceScript: "Hans" }),
      result,
    );

    expect(converted.rawText).toBe("说这群人着急");
    expect(converted.text).toBe("說這群人著急");
    expect(converted.reference).toBe("這個軟件裡的鼠標");
  });

  it("converts only the output when the reference is already Traditional", () => {
    const converted = inSetScript(
      clip({ set: "yue", script: "Hant", text: "佢哋喺度" }),
      result,
    );

    // Taiwan forms (說, 群, 著), which the FLEURS Cantonese references use.
    expect(converted.text).toBe("說這群人著急");
    expect(converted).not.toHaveProperty("reference");
  });
});
