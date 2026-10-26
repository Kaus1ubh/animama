/**
 * Messages between the page and an offline speech-to-text worker (Parakeet or
 * SenseVoice). Each engine's worker loads its own model files, given as a map
 * of URLs; transcription and disposal are the same for both.
 */

/**
 * `wasm`: the CPU set on single-thread WASM (default).
 * `webgpu`: the optional GPU set on WebGPU (experimental setting).
 */
export type OfflineSttBackend = "wasm" | "webgpu";

/** Model file URLs by role, each pinned to its set's version. */
export type OfflineSttModelUrls = Record<string, string>;

export type OfflineSttWorkerResponseType =
  | "offline_stt/load_result"
  | "offline_stt/transcribe_result"
  | "offline_stt/dispose_result";

export type OfflineSttLoadRequest<
  Urls extends OfflineSttModelUrls = OfflineSttModelUrls,
> = {
  type: "offline_stt/load";
  requestId: string;
  modelUrls: Urls;
  backend: OfflineSttBackend;
  sampleRateHz: number;
};

/**
 * `final` decodes a closed speech window and is the only source of dictated or
 * submitted text. `preview` decodes the still-growing window for display-only
 * interim text.
 */
export type OfflineSttTranscribeKind = "preview" | "final";

export type OfflineSttTranscribeRequest = {
  type: "offline_stt/transcribe";
  requestId: string;
  kind: OfflineSttTranscribeKind;
  jobId: string;
  runId: string;
  turnId: string;
  windowId: string;
  audio: Float32Array;
  sampleRateHz: number;
  /** The conversation language for a multilingual engine; English engines ignore it. */
  language?: string;
};

export type OfflineSttDisposeRequest = {
  type: "offline_stt/dispose";
  requestId: string;
};

export type OfflineSttWorkerRequest<
  Urls extends OfflineSttModelUrls = OfflineSttModelUrls,
> =
  | OfflineSttLoadRequest<Urls>
  | OfflineSttTranscribeRequest
  | OfflineSttDisposeRequest;

export type OfflineSttLoadResult<
  Urls extends OfflineSttModelUrls = OfflineSttModelUrls,
> = {
  backend: OfflineSttBackend;
  modelUrls: Urls;
  sampleRateHz: number;
  loadMs: number;
  reused: boolean;
};

export type OfflineSttTranscribeResult = {
  jobId: string;
  runId: string;
  turnId: string;
  windowId: string;
  text: string;
  isFinal: boolean;
  sampleRateHz: number;
  audioSamples: number;
  audioDurationMs: number;
  transcribeMs: number;
  /** Engine-specific decode metrics, for diagnostics only. */
  metrics: Record<string, unknown> | null;
};

export type OfflineSttDisposeResult = {
  disposed: true;
};

type OfflineSttError = {
  message: string;
  stack?: string;
};

export type OfflineSttWorkerResponse =
  | {
      type: "offline_stt/load_result";
      requestId: string;
      ok: true;
      result: OfflineSttLoadResult;
    }
  | {
      type: "offline_stt/transcribe_result";
      requestId: string;
      ok: true;
      result: OfflineSttTranscribeResult;
    }
  | {
      type: "offline_stt/dispose_result";
      requestId: string;
      ok: true;
      result: OfflineSttDisposeResult;
    }
  | {
      type: OfflineSttWorkerResponseType;
      requestId: string;
      ok: false;
      error: OfflineSttError;
    };
