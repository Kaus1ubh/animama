import { describe, expect, it, vi } from "vitest";

import {
  cacheWebgpuProbe,
  probeWebgpuModel,
  resolveSpeechBackend,
  withWebgpuModel,
  type WebgpuModelStatus,
} from "./webgpu";

const ENCODER_URL = "/__client-parakeet-webgpu-models/encoder-model.fp16.onnx";

function gpu(adapter: unknown) {
  return { requestAdapter: vi.fn(async () => adapter) };
}

describe("probeWebgpuModel", () => {
  it("reports unsupported without navigator.gpu or an adapter", async () => {
    const fetch = vi.fn();
    await expect(
      probeWebgpuModel({ modelUrl: ENCODER_URL, gpu: undefined, fetch }),
    ).resolves.toBe("unsupported");
    await expect(
      probeWebgpuModel({ modelUrl: ENCODER_URL, gpu: gpu(null), fetch }),
    ).resolves.toBe("unsupported");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports model_missing when the encoder is not served", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      probeWebgpuModel({ modelUrl: ENCODER_URL, gpu: gpu({}), fetch }),
    ).resolves.toBe("model_missing");
    expect(fetch).toHaveBeenCalledWith(ENCODER_URL, { method: "HEAD" });
  });

  it("reports model_missing when the probe request fails", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("network");
    });
    await expect(
      probeWebgpuModel({ modelUrl: ENCODER_URL, gpu: gpu({}), fetch }),
    ).resolves.toBe("model_missing");
  });

  it("reports available with an adapter and a served encoder", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(
      probeWebgpuModel({ modelUrl: ENCODER_URL, gpu: gpu({}), fetch }),
    ).resolves.toBe("available");
  });
});

describe("resolveSpeechBackend", () => {
  it("uses WASM when the experimental setting is off", () => {
    expect(
      resolveSpeechBackend({ preferWebgpu: false, status: "available" }),
    ).toEqual({ backend: "wasm", reason: "setting_off" });
  });

  it.each<WebgpuModelStatus>(["unsupported", "model_missing"])(
    "falls back to WASM when WebGPU is %s",
    (status) => {
      expect(resolveSpeechBackend({ preferWebgpu: true, status })).toEqual({
        backend: "wasm",
        reason: status,
      });
    },
  );

  it("selects WebGPU when enabled and available", () => {
    expect(
      resolveSpeechBackend({ preferWebgpu: true, status: "available" }),
    ).toEqual({ backend: "webgpu", reason: "available" });
  });
});

describe("withWebgpuModel", () => {
  const base = {
    encoderUrl:
      "http://app.test/onnx/models/parakeet-tdt-0.6b-v2/encoder-model.int8.onnx?v=0.1.0-aaaa",
    decoderUrl:
      "http://app.test/onnx/models/parakeet-tdt-0.6b-v2/decoder_joint-model.int8.onnx?v=0.1.0-aaaa",
  };
  const gpuEncoder =
    "http://app.test/onnx/models/parakeet-tdt-0.6b-v2-webgpu/encoder-model.fp16.onnx";

  it("loads the GPU encoder unversioned while base files keep the base pack version", () => {
    expect(withWebgpuModel(base, "encoderUrl", "webgpu", gpuEncoder)).toEqual({
      encoderUrl: gpuEncoder,
      decoderUrl: base.decoderUrl,
    });
  });

  it("keeps the INT8 encoder for WASM or when the build serves no GPU encoder", () => {
    expect(withWebgpuModel(base, "encoderUrl", "wasm", gpuEncoder)).toBe(base);
    expect(withWebgpuModel(base, "encoderUrl", "webgpu", null)).toBe(base);
  });
});

describe("cacheWebgpuProbe", () => {
  it("caches a settled result but probes again while the encoder is missing", async () => {
    const results: WebgpuModelStatus[] = [
      "model_missing",
      "available",
      "unsupported",
    ];
    const probe = vi.fn(async () => results.shift() ?? "unsupported");
    const status = cacheWebgpuProbe(probe);

    // The encoder can be installed while the page stays open (self-host).
    await expect(status()).resolves.toBe("model_missing");
    await expect(status()).resolves.toBe("available");
    await expect(status()).resolves.toBe("available");
    expect(probe).toHaveBeenCalledTimes(2);

    await expect(status(true)).resolves.toBe("unsupported");
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight probe between concurrent callers", async () => {
    const probe = vi.fn(async () => "model_missing" as const);
    const status = cacheWebgpuProbe(probe);
    await Promise.all([status(), status()]);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
