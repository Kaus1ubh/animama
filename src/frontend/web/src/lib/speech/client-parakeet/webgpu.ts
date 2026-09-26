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
   * An adapter exists but the encoder is not installed: desktop can download
   * its pack; self-host needs the operator-mounted set.
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
 * Swap in the GPU encoder for a WebGPU load. It belongs to its own pack, so it
 * never carries the base pack's `?v=` version. Desktop revalidates it by its
 * SHA-256 ETag; self-host serves the mounted file `no-cache`.
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
