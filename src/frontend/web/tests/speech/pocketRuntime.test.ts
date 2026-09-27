import { describe, expect, it } from "vitest";

import {
  createStateArrays,
  framesAfterEos,
  maxFramesForTokens,
  parseNpyFloat32,
  parseSafetensors,
  prependBos,
  resolveBuiltInVoices,
  stateArraysFromVoiceState,
} from "../../public/tts/workers/pocket-runtime.js";

type TensorSpec = {
  dtype: "F32" | "I64";
  shape: number[];
  values: number[];
};

/** Encode tensors in the safetensors layout: u64 header length, JSON, bytes. */
function buildSafetensors(tensors: Record<string, TensorSpec>): ArrayBuffer {
  const header: Record<string, unknown> = { __metadata__: { format: "pt" } };
  const payloads: Uint8Array[] = [];
  let offset = 0;
  for (const [name, spec] of Object.entries(tensors)) {
    const bytes =
      spec.dtype === "F32"
        ? new Uint8Array(Float32Array.from(spec.values).buffer)
        : new Uint8Array(BigInt64Array.from(spec.values.map(BigInt)).buffer);
    header[name] = {
      dtype: spec.dtype,
      shape: spec.shape,
      data_offsets: [offset, offset + bytes.length],
    };
    payloads.push(bytes);
    offset += bytes.length;
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const output = new Uint8Array(8 + headerBytes.length + offset);
  new DataView(output.buffer).setBigUint64(0, BigInt(headerBytes.length), true);
  output.set(headerBytes, 8);
  let cursor = 8 + headerBytes.length;
  for (const payload of payloads) {
    output.set(payload, cursor);
    cursor += payload.length;
  }
  return output.buffer;
}

/** Encode a little-endian float32 C-order .npy (format 1.0). */
function buildNpy(shape: number[], values: number[]): ArrayBuffer {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(", ")}${shape.length === 1 ? "," : ""}), }`;
  const unpadded = 10 + header.length + 1;
  header += " ".repeat((64 - (unpadded % 64)) % 64) + "\n";
  const headerBytes = new TextEncoder().encode(header);
  const output = new Uint8Array(10 + headerBytes.length + values.length * 4);
  output.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  new DataView(output.buffer).setUint16(8, headerBytes.length, true);
  output.set(headerBytes, 10);
  output.set(
    new Uint8Array(Float32Array.from(values).buffer),
    10 + headerBytes.length,
  );
  return output.buffer;
}

const flowManifest = [
  {
    index: 0,
    input_name: "state_0",
    module: "transformer.layers.0.self_attn",
    key: "cache",
    dtype: "float32",
    fill: "nan",
    shape: [2, 1, 4, 1, 2],
  },
  {
    index: 1,
    input_name: "state_1",
    module: "transformer.layers.0.self_attn",
    key: "current_end",
    dtype: "float32",
    fill: "empty",
    shape: [0],
  },
  {
    index: 2,
    input_name: "state_2",
    module: "transformer.layers.0.self_attn",
    key: "step",
    dtype: "int64",
    fill: "zeros",
    shape: [1],
  },
];

describe("Pocket runtime state manifests", () => {
  it("initializes each state with its declared dtype, shape and fill", () => {
    const state = createStateArrays([
      ...flowManifest,
      {
        index: 3,
        input_name: "state_3",
        module: "decoder",
        key: "first",
        dtype: "bool",
        fill: "ones",
        shape: [1],
      },
    ]);

    expect(state.state_0.shape).toEqual([2, 1, 4, 1, 2]);
    expect(state.state_0.data).toHaveLength(16);
    expect(Array.from(state.state_0.data).every(Number.isNaN)).toBe(true);
    expect(state.state_1).toMatchObject({ dtype: "float32", shape: [0] });
    expect(state.state_1.data).toHaveLength(0);
    expect(state.state_2.dtype).toBe("int64");
    expect(Array.from(state.state_2.data)).toEqual([0n]);
    expect(state.state_3.dtype).toBe("bool");
    expect(Array.from(state.state_3.data)).toEqual([1]);
  });
});

describe("Pocket voice states", () => {
  it("parses safetensors tensors by name", () => {
    const tensors = parseSafetensors(
      buildSafetensors({
        "layer/cache": { dtype: "F32", shape: [2], values: [1.5, -2] },
        "layer/offset": { dtype: "I64", shape: [1], values: [7] },
      }),
    );

    expect(tensors.get("layer/cache")).toMatchObject({ shape: [2] });
    expect(Array.from(tensors.get("layer/cache")!.data)).toEqual([1.5, -2]);
    expect(Array.from(tensors.get("layer/offset")!.data)).toEqual([7n]);
    expect(tensors.has("__metadata__")).toBe(false);
  });

  it("rejects truncated or unsupported safetensors files", () => {
    expect(() => parseSafetensors(new ArrayBuffer(4))).toThrow(/safetensors/);
    const unsupported = buildSafetensors({
      x: { dtype: "F32", shape: [1], values: [1] },
    });
    const bytes = new Uint8Array(unsupported);
    const text = new TextDecoder().decode(bytes);
    const patched = new TextEncoder().encode(text.replace('"F32"', '"F16"'));
    expect(() => parseSafetensors(patched.buffer)).toThrow(/F16/);
  });

  it("copies a short voice cache into the NaN-filled slots and sets step from offset", () => {
    // Voice prompt of T=2 positions: [kv=2, batch=1, T=2, heads=1, dim=2].
    const cache = [1, 2, 3, 4, 5, 6, 7, 8];
    const tensors = parseSafetensors(
      buildSafetensors({
        "transformer.layers.0.self_attn/cache": {
          dtype: "F32",
          shape: [2, 1, 2, 1, 2],
          values: cache,
        },
        "transformer.layers.0.self_attn/offset": {
          dtype: "I64",
          shape: [1],
          values: [2],
        },
      }),
    );

    const state = stateArraysFromVoiceState(tensors, flowManifest);

    const slots = Array.from(state.state_0.data);
    // Key half: positions 0-1 filled, positions 2-3 remain NaN.
    expect(slots.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(slots.slice(4, 8).every(Number.isNaN)).toBe(true);
    // Value half starts at 4 positions * 2 values.
    expect(slots.slice(8, 12)).toEqual([5, 6, 7, 8]);
    expect(slots.slice(12, 16).every(Number.isNaN)).toBe(true);
    expect(state.state_1.data).toHaveLength(0);
    expect(Array.from(state.state_2.data)).toEqual([2n]);
  });

  it("rejects a voice state that does not fit the manifest", () => {
    const tensors = parseSafetensors(
      buildSafetensors({
        "transformer.layers.0.self_attn/cache": {
          dtype: "F32",
          shape: [2, 1, 5, 1, 2],
          values: new Array(20).fill(0),
        },
        "transformer.layers.0.self_attn/offset": {
          dtype: "I64",
          shape: [1],
          values: [5],
        },
      }),
    );

    expect(() => stateArraysFromVoiceState(tensors, flowManifest)).toThrow(
      /state_0/,
    );
  });

  it.each([
    ["missing cache", { offset: [2] }, /cache/],
    ["missing offset", { cache: true }, /offset/],
    ["offset beyond the cache", { cache: true, offset: [3] }, /offset/],
  ])("rejects a voice state with %s", (_label, parts, message) => {
    const tensors: Record<string, TensorSpec> = {};
    if ("cache" in parts) {
      tensors["transformer.layers.0.self_attn/cache"] = {
        dtype: "F32",
        shape: [2, 1, 2, 1, 2],
        values: [1, 2, 3, 4, 5, 6, 7, 8],
      };
    }
    if ("offset" in parts) {
      tensors["transformer.layers.0.self_attn/offset"] = {
        dtype: "I64",
        shape: [1],
        values: parts.offset as number[],
      };
    }
    expect(() =>
      stateArraysFromVoiceState(
        parseSafetensors(buildSafetensors(tensors)),
        flowManifest,
      ),
    ).toThrow(message);
  });

  it("rejects a tensor whose bytes do not match its shape", () => {
    const buffer = buildSafetensors({
      x: { dtype: "F32", shape: [2], values: [1, 2] },
    });
    const text = new TextDecoder().decode(new Uint8Array(buffer));
    const patched = new TextEncoder().encode(text.replace("[2]", "[3]"));
    expect(() => parseSafetensors(patched.buffer)).toThrow(/shape/);
  });
});

describe("Pocket voice conditioning", () => {
  it("parses a float32 .npy and prepends the BOS row", () => {
    const bos = parseNpyFloat32(buildNpy([1, 1, 2], [9, 8]));
    expect(bos.shape).toEqual([1, 1, 2]);

    const conditioned = prependBos(bos, {
      shape: [1, 2, 2],
      data: Float32Array.from([1, 2, 3, 4]),
    });

    expect(conditioned.shape).toEqual([1, 3, 2]);
    expect(Array.from(conditioned.data)).toEqual([9, 8, 1, 2, 3, 4]);
  });

  it("rejects a BOS row with a different embedding width", () => {
    const bos = parseNpyFloat32(buildNpy([1, 1, 3], [1, 2, 3]));
    expect(() =>
      prependBos(bos, { shape: [1, 1, 2], data: Float32Array.from([1, 2]) }),
    ).toThrow(/width/);
  });
});

describe("Pocket generation limits", () => {
  it("extends the tail after EOS for short prompts", () => {
    expect(framesAfterEos("Hi there!")).toBe(5);
    expect(framesAfterEos("One two three four.")).toBe(5);
    expect(framesAfterEos("One two three four five.")).toBe(3);
  });

  it("bounds generation length by token count", () => {
    // ceil((9 / 3 + 2) * 12.5) = ceil(62.5) = 63
    expect(maxFramesForTokens(9)).toBe(63);
    expect(maxFramesForTokens(0)).toBe(25);
  });
});

describe("resolveBuiltInVoices", () => {
  it("keeps the configured order and default", () => {
    expect(
      resolveBuiltInVoices({
        voices: ["azelma", "eve", "caro_davy"],
        defaultVoice: "eve",
      }),
    ).toEqual({
      names: ["azelma", "eve", "caro_davy"],
      defaultVoice: "eve",
      voiceUrls: {},
    });
  });

  it("falls back to the first voice when the default is not listed", () => {
    expect(
      resolveBuiltInVoices({
        voices: ["azelma", "jane"],
        defaultVoice: "cosette",
      }),
    ).toEqual({
      names: ["azelma", "jane"],
      defaultVoice: "azelma",
      voiceUrls: {},
    });
  });

  it("accepts content-route URLs for downloadable voices", () => {
    expect(
      resolveBuiltInVoices({
        voices: ["eve", "anna"],
        defaultVoice: "eve",
        voiceUrls: { anna: "/v1/model-assets/pocket-voice-anna/content" },
      }),
    ).toEqual({
      names: ["eve", "anna"],
      defaultVoice: "eve",
      voiceUrls: { anna: "/v1/model-assets/pocket-voice-anna/content" },
    });
  });

  it("rejects voice URLs outside the model-asset content route", () => {
    for (const url of [
      "https://example.com/anna.safetensors",
      "/v1/model-assets/../secrets/content",
      "/onnx/models/pocket-tts/voices/anna.safetensors",
    ]) {
      expect(() =>
        resolveBuiltInVoices({ voices: ["anna"], voiceUrls: { anna: url } }),
      ).toThrow(/voice URL/);
    }
    expect(() =>
      resolveBuiltInVoices({
        voices: ["eve"],
        voiceUrls: { anna: "/v1/model-assets/pocket-voice-anna/content" },
      }),
    ).toThrow(/not listed/);
  });

  it("rejects missing, duplicate or unsafe voice names", () => {
    expect(() => resolveBuiltInVoices({})).toThrow(/voice/);
    expect(() => resolveBuiltInVoices({ voices: [] })).toThrow(/voice/);
    expect(() => resolveBuiltInVoices({ voices: ["eve", "eve"] })).toThrow(
      /duplicate/,
    );
    expect(() => resolveBuiltInVoices({ voices: ["../eve"] })).toThrow(
      /voice name/,
    );
    expect(() => resolveBuiltInVoices({ voices: ["Eve"] })).toThrow(
      /voice name/,
    );
  });
});
