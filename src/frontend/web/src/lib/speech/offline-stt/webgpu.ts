/**
 * Experimental WebGPU backend selection for the offline speech engines.
 *
 * WebGPU runs a file from the engine's optional GPU set (the CPU set's INT8
 * graphs cannot run there). It is used only when the owner's experimental
 * setting is on, the device exposes a WebGPU adapter, and the current build
 * serves the GPU set; otherwise the WASM backend is used.
 */
import type { OfflineSttBackend } from "./worker-protocol";

export type WebgpuModelStatus =
  /** An adapter exists and the GPU set's model file is served. */
  | "available"
  /** No `navigator.gpu` or no adapter on this device/browser. */
  | "unsupported"
  /**
   * An adapter exists but the GPU set is not installed: built apps download
   * it in the app; development stacks mount the operator's set.
   */
  | "model_missing";

export type SpeechBackendReason =
  | WebgpuModelStatus
  | "setting_off"
  /** WebGPU passed the probe but failed to load in the worker this page. */
  | "load_failed";

type GpuLike = {
  requestAdapter: () => Promise<unknown>;
};

export async function probeWebgpuModel({
  modelUrl,
  gpu,
  fetch,
}: {
  modelUrl: string;
  gpu: GpuLike | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<WebgpuModelStatus> {
  if (!gpu) return "unsupported";
  try {
    if (!(await gpu.requestAdapter())) return "unsupported";
  } catch {
    return "unsupported";
  }
  try {
    const response = await fetch(modelUrl, { method: "HEAD" });
    return response.ok ? "available" : "model_missing";
  } catch {
    return "model_missing";
  }
}

/**
 * Swap in the GPU set's file for the `key` role on a WebGPU load. It belongs to
 * the separate GPU set, so the caller pins it with that set's own `?v=`
 * version, never the base set's.
 */
export function withWebgpuModel<T extends Record<string, string>>(
  urls: T,
  key: keyof T,
  backend: OfflineSttBackend,
  webgpuModelUrl: string | null,
): T {
  return backend === "webgpu" && webgpuModelUrl
    ? { ...urls, [key]: webgpuModelUrl }
    : urls;
}

/**
 * Cache the probe for the page, except a `model_missing` result: built apps
 * install the GPU set without a reload, so the next caller probes again (one
 * same-origin `HEAD`). `refresh` always probes again.
 */
export function cacheWebgpuProbe(
  probe: () => Promise<WebgpuModelStatus>,
): (refresh?: boolean) => Promise<WebgpuModelStatus> {
  let cached: Promise<WebgpuModelStatus> | null = null;
  let settled: WebgpuModelStatus | null = null;
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

export function resolveSpeechBackend({
  preferWebgpu,
  status,
}: {
  preferWebgpu: boolean;
  status: WebgpuModelStatus;
}): { backend: OfflineSttBackend; reason: SpeechBackendReason } {
  if (!preferWebgpu) return { backend: "wasm", reason: "setting_off" };
  return status === "available"
    ? { backend: "webgpu", reason: status }
    : { backend: "wasm", reason: status };
}
