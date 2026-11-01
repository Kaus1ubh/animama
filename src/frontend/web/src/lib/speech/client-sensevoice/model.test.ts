import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeSenseVoiceLogits,
  isSenseVoiceLanguage,
  loadSenseVoiceModel,
  parseTokenTable,
  wordConfidenceFloor,
} from "./model";

/** The ONNX session's output for the model-level tests. */
const session = vi.hoisted(() => ({
  logits: new Float32Array(0),
  vocab: 0,
  /** The last run's inputs, by name. */
  feeds: {} as Record<string, { data: unknown }>,
}));
vi.mock("onnxruntime-web", () => ({
  // The model only builds inputs; the mocked session records and ignores them.
  Tensor: class {
    data: unknown;
    constructor(_type: string, data: unknown) {
      this.data = data;
    }
  },
  InferenceSession: {
    create: async () => ({
      run: async (feeds: Record<string, { data: unknown }>) => {
        session.feeds = feeds;
        return {
          logits: {
            dims: [1, session.logits.length / session.vocab, session.vocab],
            data: session.logits,
            dispose: () => {},
          },
        };
      },
      release: async () => {},
    }),
  },
}));

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

/** The decoded text alone. */
const decodeText = (...args: Parameters<typeof decodeSenseVoiceLogits>) =>
  decodeSenseVoiceLogits(...args).text;

describe("decodeSenseVoiceLogits", () => {
  it("collapses repeats, drops blanks and strips the tag frames", () => {
    const frames = [1, 2, 3, 4, 7, 7, 0, 8, 8];
    expect(
      decodeText(
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
      decodeText(
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
        decodeText(
          logits([...frames], tokens.length),
          frames.length,
          tokens.length,
          tokens,
        ),
      ).toBe(text);
  });

  it("yields no text for a window of punctuation alone", () => {
    const decode = (frames: number[]) =>
      decodeText(
        logits(frames, tokens.length),
        frames.length,
        tokens.length,
        tokens,
      );
    expect(decode([1, 13])).toBe("");
    expect(decode([12, 0, 13])).toBe("");
    expect(decode([7, 12])).toBe("こん。");
  });

  it("yields no text for a word the model barely believes, as for silence", () => {
    // One frame where こん narrowly beats the other 13 tokens.
    const values = new Float32Array(tokens.length).fill(0);
    values[7] = 1;
    const weak = decodeSenseVoiceLogits(values, 1, tokens.length, tokens);
    expect(weak.text).toBe("");
    expect(weak.wordConfidence).toBeCloseTo(0.173, 3);
    values[7] = 4;
    const sure = decodeSenseVoiceLogits(values, 1, tokens.length, tokens);
    expect(sure.text).toBe("こん");
    expect(sure.wordConfidence).toBeCloseTo(0.808, 3);
  });

  it("lets a preview's word through without the confidence gate", () => {
    const values = new Float32Array(tokens.length).fill(0);
    values[7] = 1; // p ≈ 0.17, a word still being spoken
    expect(decodeSenseVoiceLogits(values, 1, tokens.length, tokens, 0)).toEqual(
      { text: "こん", wordConfidence: null },
    );
    expect(wordConfidenceFloor("preview")).toBe(0);
    expect(wordConfidenceFloor("final")).toBeGreaterThan(0.17);
  });

  it("removes tags wherever they appear, even mid-utterance", () => {
    const frames = [7, 3, 8];
    expect(
      decodeText(
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

describe("loadSenseVoiceModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gates a final window but not a preview of the same audio", async () => {
    const dims = 80 * 7;
    const metadata = {
      neg_mean: Array(dims).fill(0).join(","),
      inv_stddev: Array(dims).fill(1).join(","),
      lfr_window_size: "7",
      lfr_window_shift: "6",
      with_itn: "14",
      lang_ja: "11",
    };
    vi.stubGlobal(
      "fetch",
      async (url: string) =>
        new Response(
          url.endsWith("metadata.json")
            ? JSON.stringify(metadata)
            : tokens.map((piece, id) => `${piece} ${id}`).join("\n"),
        ),
    );
    // Whatever the audio, the session answers with one weakly believed こん.
    session.vocab = tokens.length;
    session.logits = new Float32Array(tokens.length).fill(0);
    session.logits[7] = 1;
    const model = await loadSenseVoiceModel(
      {
        modelUrl: "/model.int8.onnx",
        tokensUrl: "/tokens.txt",
        metadataUrl: "/metadata.json",
      },
      "wasm",
    );
    const audio = Float32Array.from({ length: 16_000 }, (_, i) =>
      Math.sin(i / 7),
    );

    expect((await model.transcribe(audio, "ja", "final")).text).toBe("");
    expect((await model.transcribe(audio, "ja", "preview")).text).toBe("こん");
    // A final window is the default.
    expect((await model.transcribe(audio, "ja")).text).toBe("");
  });

  it("detects the language under auto and keeps the model's own script", async () => {
    const dims = 80 * 7;
    const metadata = {
      neg_mean: Array(dims).fill(0).join(","),
      inv_stddev: Array(dims).fill(1).join(","),
      lfr_window_size: "7",
      lfr_window_shift: "6",
      with_itn: "14",
      lang_auto: "0",
      lang_zh: "3",
    };
    // A Simplified Chinese word at id 14.
    const zhTokens = [...tokens, "说"];
    vi.stubGlobal(
      "fetch",
      async (url: string) =>
        new Response(
          url.endsWith("metadata.json")
            ? JSON.stringify(metadata)
            : zhTokens.map((piece, id) => `${piece} ${id}`).join("\n"),
        ),
    );
    // Whatever the audio, the session answers with a confident Simplified 说.
    session.vocab = zhTokens.length;
    session.logits = Float32Array.from(logits([14], zhTokens.length));
    const model = await loadSenseVoiceModel(
      {
        modelUrl: "/model.int8.onnx",
        tokensUrl: "/tokens.txt",
        metadataUrl: "/metadata.json",
      },
      "wasm",
    );
    const audio = Float32Array.from({ length: 16_000 }, (_, i) =>
      Math.sin(i / 7),
    );

    expect((await model.transcribe(audio, "auto")).text).toBe("说");
    expect(session.feeds.language.data).toEqual(Int32Array.of(0));
    // zh-Hant also detects the language, then writes Traditional script.
    expect((await model.transcribe(audio, "zh-Hant")).text).toBe("說");
    expect(session.feeds.language.data).toEqual(Int32Array.of(0));
  });
});

describe("isSenseVoiceLanguage", () => {
  it("accepts the routed languages, including automatic detection", () => {
    for (const language of ["auto", "en", "ja", "ko", "zh-Hans", "zh-Hant"])
      expect(isSenseVoiceLanguage(language)).toBe(true);
    expect(isSenseVoiceLanguage("fr")).toBe(false);
  });
});
