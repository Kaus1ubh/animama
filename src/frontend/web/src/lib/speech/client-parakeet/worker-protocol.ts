import type { TranscribeResult } from "parakeet.js";

export type ClientParakeetBackend = "wasm";

export type ClientParakeetModelUrls = {
  encoderUrl: string;
  decoderUrl: string;
  tokenizerUrl: string;
  preprocessorUrl: string;
};

export type ClientParakeetWorkerRequestType =
  | "client_parakeet/load"
  | "client_parakeet/transcribe"
  | "client_parakeet/dispose";

export type ClientParakeetWorkerResponseType =
  | "client_parakeet/load_result"
  | "client_parakeet/transcribe_result"
  | "client_parakeet/dispose_result";

export type ClientParakeetLoadRequest = {
  type: "client_parakeet/load";
  requestId: string;
  modelUrls: ClientParakeetModelUrls;
  backend: ClientParakeetBackend;
  sampleRateHz: number;
};

export type ClientParakeetTranscribeRequest = {
  type: "client_parakeet/transcribe";
  requestId: string;
  jobId: string;
  runId: string;
  turnId: string;
  windowId: string;
  audio: Float32Array;
  sampleRateHz: number;
};

export type ClientParakeetDisposeRequest = {
  type: "client_parakeet/dispose";
  requestId: string;
};

export type ClientParakeetWorkerRequest =
  | ClientParakeetLoadRequest
  | ClientParakeetTranscribeRequest
  | ClientParakeetDisposeRequest;

export type ClientParakeetLoadResult = {
  backend: ClientParakeetBackend;
  modelUrls: ClientParakeetModelUrls;
  sampleRateHz: number;
  loadMs: number;
  reused: boolean;
};

export type ClientParakeetTranscribeMetrics = NonNullable<
  TranscribeResult["metrics"]
>;

export type ClientParakeetTranscribeResult = {
  jobId: string;
  runId: string;
  turnId: string;
  windowId: string;
  text: string;
  isFinal: true;
  sampleRateHz: number;
  audioSamples: number;
  audioDurationMs: number;
  transcribeMs: number;
  metrics: ClientParakeetTranscribeMetrics | null;
};

export type ClientParakeetDisposeResult = {
  disposed: true;
};

export type ClientParakeetError = {
  message: string;
  stack?: string;
};

export type ClientParakeetLoadResponse = {
  type: "client_parakeet/load_result";
  requestId: string;
  ok: true;
  result: ClientParakeetLoadResult;
};

export type ClientParakeetTranscribeResponse = {
  type: "client_parakeet/transcribe_result";
  requestId: string;
  ok: true;
  result: ClientParakeetTranscribeResult;
};

export type ClientParakeetDisposeResponse = {
  type: "client_parakeet/dispose_result";
  requestId: string;
  ok: true;
  result: ClientParakeetDisposeResult;
};

export type ClientParakeetErrorResponse = {
  type: ClientParakeetWorkerResponseType;
  requestId: string;
  ok: false;
  error: ClientParakeetError;
};

export type ClientParakeetWorkerResponse =
  | ClientParakeetLoadResponse
  | ClientParakeetTranscribeResponse
  | ClientParakeetDisposeResponse
  | ClientParakeetErrorResponse;
