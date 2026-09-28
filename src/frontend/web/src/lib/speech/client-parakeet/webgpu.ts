/**
 * Experimental WebGPU backend selection for client Parakeet.
 *
 * WebGPU runs the optional FP16 encoder on the GPU (the INT8 encoder cannot run
 * there) and keeps the INT8 decoder on WASM. It is used only when the owner's
 * experimental setting is on, the device exposes a WebGPU adapter, and the
 * current build serves the optional encoder; otherwise the WASM backend is used.
 */
import type { ClientParakeetBackend } from "./worker-protocol";

export type ParakeetWebgpuStatus =
  /** An adapter exists and the FP16 encoder is served. */
  | "available"
  /** No `navigator.gpu` or no adapter on this device/browser. */
  | "unsupported"
  /**
   * An adapter exists but the encoder is not installed: desktop downloads its
   * pack, built self-host its model asset; development stacks mount the set.
   */
  | "model_missing"
  /** This build never serves the encoder (a Vite stack with a base-URL override). */
  | "unavailable_in_build";

export type ParakeetBackendReason =
  | ParakeetWebgpuStatus
  | "setting_off"
  /** WebGPU passed the probe but failed to load in the worker this page. */
  | "load_failed";

type GpuLike = {
  requestAdapter: () => Promise<unknown>;
};

export async function probeParakeetWebgpu({
  encoderUrl,
  gpu,
  fetch,
}: {
  encoderUrl: string | null;
  gpu: GpuLike | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<ParakeetWebgpuStatus> {
  if (!encoderUrl) return "unavailable_in_build";
  if (!gpu) return "unsupported";
  try {
    if (!(await gpu.requestAdapter())) return "unsupported";
  } catch {
    return "unsupported";
  }
  try {
    const response = await fetch(encoderUrl, { method: "HEAD" });
    return response.ok ? "available" : "model_missing";
  } catch {
    return "model_missing";
  }
}

/**
 * Swap in the GPU encoder for a WebGPU load. It is delivered separately from
 * the base models, so it never carries the base pack's `?v=` version. Desktop
 * packs and self-host model assets are served `no-cache` and revalidated by
 * their SHA-256 ETag.
 */
export function withBackendEncoder<T extends { encoderUrl: string }>(
  urls: T,
  backend: ClientParakeetBackend,
  webgpuEncoderUrl: string | null,
): T {
  return backend === "webgpu" && webgpuEncoderUrl
    ? { ...urls, encoderUrl: webgpuEncoderUrl }
    : urls;
}

/**
 * Cache the probe for the page, except a `model_missing` result: built
 * self-host installs the encoder without a reload, so the next caller probes
 * again (one same-origin `HEAD`). `refresh` always probes again.
 */
export function cacheParakeetWebgpuProbe(
  probe: () => Promise<ParakeetWebgpuStatus>,
): (refresh?: boolean) => Promise<ParakeetWebgpuStatus> {
  let cached: Promise<ParakeetWebgpuStatus> | null = null;
  let settled: ParakeetWebgpuStatus | null = null;
  return (refresh = false) => {
    if (!cached || refresh || settled === "model_missing") {
      const current = probe();
      cached = current;
      settled = null;
      void current.then((status) => {
        // A newer probe owns the cache; never let an older result overwrite it.
        if (cached === current) settled = status;
      });
    }
    return cached;
  };
}

export function resolveParakeetBackend({
  preferWebgpu,
  status,
}: {
  preferWebgpu: boolean;
  status: ParakeetWebgpuStatus;
}): { backend: ClientParakeetBackend; reason: ParakeetBackendReason } {
  if (!preferWebgpu) return { backend: "wasm", reason: "setting_off" };
  return status === "available"
    ? { backend: "webgpu", reason: status }
    : { backend: "wasm", reason: status };
}
