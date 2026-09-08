import type {
  Vowel5FrameValues,
  VowelVisemeLipSyncSegment,
} from "./vowelVisemeSegment";
import type {
  GruutVisemeKeyframePlan,
  SpeechGestureTimeline,
} from "@/lib/speech/gruut-viseme-keyframes";

export type GruutVisemeKeyframePlanSummary = Omit<
  GruutVisemeKeyframePlan,
  "keyframes"
>;

export type VisemeWorkerBuildMode =
  | "estimated_provisional"
  | "actual_prestart"
  | "actual_inflight";

export type VisemeWorkerOverrunPolicy = {
  minSec: number;
  ratio: number;
  maxSec: number;
};

export type VisemeWorkerAnchor = {
  elapsedSec: number;
  currentDurationSec: number;
  currentValues: Vowel5FrameValues;
};

export type VisemeWorkerBuildRequest = {
  type: "build_viseme_assets_from_raw";
  requestId: string;
  runId: string;
  mode: VisemeWorkerBuildMode;
  phonemizedText: string[][] | null;
  tokenizedText: string | null;
  fps?: number;
  targetDurationSec?: number | null;
  anchor?: VisemeWorkerAnchor | null;
  provisionalOverrun?: VisemeWorkerOverrunPolicy | null;
};

export type VisemeWorkerBuildResult = {
  planSummary: GruutVisemeKeyframePlanSummary;
  speechGestureTimeline: SpeechGestureTimeline;
  segment: VowelVisemeLipSyncSegment;
  buildMode: VisemeWorkerBuildMode;
  provisionalMarginSec: number | null;
  provisionalTargetDurationSec: number | null;
  workerElapsedMs: number;
};

export type VisemeWorkerSuccessResponse = {
  type: "build_viseme_assets_from_raw_result";
  requestId: string;
  ok: true;
  result: VisemeWorkerBuildResult;
};

export type VisemeWorkerErrorResponse = {
  type: "build_viseme_assets_from_raw_result";
  requestId: string;
  ok: false;
  error: {
    message: string;
    stack?: string;
  };
};

export type VisemeWorkerResponse =
  | VisemeWorkerSuccessResponse
  | VisemeWorkerErrorResponse;
