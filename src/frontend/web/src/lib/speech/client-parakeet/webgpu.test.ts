import { describe, expect, it, vi } from "vitest";

import {
  probeParakeetWebgpu,
  resolveParakeetBackend,
  withBackendEncoder,
  type ParakeetWebgpuStatus,
} from "./webgpu";

const ENCODER_URL = "/__client-parakeet-webgpu-models/encoder-model.fp16.onnx";

function gpu(adapter: unknown) {
  return { requestAdapter: vi.fn(async () => adapter) };
}

describe("probeParakeetWebgpu", () => {
  it("reports unavailable_in_build when the build serves no GPU model", async () => {
    await expect(
      probeParakeetWebgpu({
        encoderUrl: null,
        gpu: gpu({}),
        fetch: vi.fn(),
      }),
    ).resolves.toBe("unavailable_in_build");
  });

  it("reports unsupported without navigator.gpu or an adapter", async () => {
    const fetch = vi.fn();
    await expect(
      probeParakeetWebgpu({ encoderUrl: ENCODER_URL, gpu: undefined, fetch }),
    ).resolves.toBe("unsupported");
    await expect(
      probeParakeetWebgpu({ encoderUrl: ENCODER_URL, gpu: gpu(null), fetch }),
    ).resolves.toBe("unsupported");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports model_missing when the encoder is not served", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      probeParakeetWebgpu({ encoderUrl: ENCODER_URL, gpu: gpu({}), fetch }),
    ).resolves.toBe("model_missing");
    expect(fetch).toHaveBeenCalledWith(ENCODER_URL, { method: "HEAD" });
  });

  it("reports model_missing when the probe request fails", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(
      probeParakeetWebgpu({ encoderUrl: ENCODER_URL, gpu: gpu({}), fetch }),
    ).resolves.toBe("model_missing");
  });

  it("reports available with an adapter and a served encoder", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(
      probeParakeetWebgpu({ encoderUrl: ENCODER_URL, gpu: gpu({}), fetch }),
    ).resolves.toBe("available");
  });
});

describe("resolveParakeetBackend", () => {
  it("uses WASM when the experimental setting is off", () => {
    expect(
      resolveParakeetBackend({ preferWebgpu: false, status: "available" }),
    ).toEqual({ backend: "wasm", reason: "setting_off" });
  });

  it.each<ParakeetWebgpuStatus>([
    "unsupported",
    "model_missing",
    "unavailable_in_build",
  ])("falls back to WASM when WebGPU is %s", (status) => {
    expect(resolveParakeetBackend({ preferWebgpu: true, status })).toEqual({
      backend: "wasm",
      reason: status,
    });
  });

  it("selects WebGPU when enabled and available", () => {
    expect(
      resolveParakeetBackend({ preferWebgpu: true, status: "available" }),
    ).toEqual({ backend: "webgpu", reason: "available" });
  });
});

describe("withBackendEncoder", () => {
  const base = {
    encoderUrl:
      "http://app.test/onnx/models/parakeet-tdt-0.6b-v2/encoder-model.int8.onnx?v=0.1.0-aaaa",
    decoderUrl:
      "http://app.test/onnx/models/parakeet-tdt-0.6b-v2/decoder_joint-model.int8.onnx?v=0.1.0-aaaa",
  };
  const gpuEncoder =
    "http://app.test/onnx/models/parakeet-tdt-0.6b-v2-webgpu/encoder-model.fp16.onnx";

  it("loads the GPU encoder unversioned while base files keep the base pack version", () => {
    expect(withBackendEncoder(base, "webgpu", gpuEncoder)).toEqual({
      encoderUrl: gpuEncoder,
      decoderUrl: base.decoderUrl,
    });
  });

  it("keeps the INT8 encoder for WASM or when the build serves no GPU encoder", () => {
    expect(withBackendEncoder(base, "wasm", gpuEncoder)).toBe(base);
    expect(withBackendEncoder(base, "webgpu", null)).toBe(base);
  });
});
