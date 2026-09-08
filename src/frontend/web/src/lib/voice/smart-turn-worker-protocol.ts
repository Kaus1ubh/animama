export type SmartTurnWorkerRequestType =
  | "smart_turn/load"
  | "smart_turn/predict"
  | "smart_turn/dispose";

export type SmartTurnWorkerResponseType =
  | "smart_turn/load_result"
  | "smart_turn/predict_result"
  | "smart_turn/dispose_result";

export type SmartTurnLoadRequest = {
  type: "smart_turn/load";
  requestId: string;
  modelUrl: string;
  ortWasmBaseUrl: string;
};

export type SmartTurnPredictRequest = {
  type: "smart_turn/predict";
  requestId: string;
  jobId: string;
  turnId: string;
  audio: Float32Array;
  sampleRateHz: number;
  threshold: number;
};

export type SmartTurnDisposeRequest = {
  type: "smart_turn/dispose";
  requestId: string;
};

export type SmartTurnWorkerRequest =
  | SmartTurnLoadRequest
  | SmartTurnPredictRequest
  | SmartTurnDisposeRequest;

export type SmartTurnPredictDecision = "end_turn" | "continue";

export type SmartTurnPredictResult = {
  jobId: string;
  turnId: string;
  prediction: 0 | 1;
  decision: SmartTurnPredictDecision;
  probability: number;
  threshold: number;
  latencyMs: number;
  preprocessMs: number;
  inferenceMs: number;
  paddedLeadingSamples: number;
  truncatedLeadingSamples: number;
  inputSamples: number;
  inputShape: [number, number, number];
};

export type SmartTurnLoadResult = {
  modelUrl: string;
};

export type SmartTurnDisposeResult = {
  disposed: true;
};

export type SmartTurnError = {
  message: string;
  stack?: string;
};

export type SmartTurnLoadResponse = {
  type: "smart_turn/load_result";
  requestId: string;
  ok: true;
  result: SmartTurnLoadResult;
};

export type SmartTurnPredictResponse = {
  type: "smart_turn/predict_result";
  requestId: string;
  ok: true;
  result: SmartTurnPredictResult;
};

export type SmartTurnDisposeResponse = {
  type: "smart_turn/dispose_result";
  requestId: string;
  ok: true;
  result: SmartTurnDisposeResult;
};

export type SmartTurnErrorResponse = {
  type: SmartTurnWorkerResponseType;
  requestId: string;
  ok: false;
  error: SmartTurnError;
};

export type SmartTurnWorkerResponse =
  | SmartTurnLoadResponse
  | SmartTurnPredictResponse
  | SmartTurnDisposeResponse
  | SmartTurnErrorResponse;
