/// <reference lib="webworker" />

import { buildVowelVisemeLipSyncSegment } from "@/lib/avatar/vowelVisemeSegment";
import { createLogger } from "@/lib/logger";
import { buildGruutVisemeKeyframes } from "@/lib/speech/gruut-viseme-keyframes";
import type {
  GruutVisemeKeyframePlanSummary,
  VisemeWorkerBuildRequest,
  VisemeWorkerBuildResult,
  VisemeWorkerResponse,
} from "@/lib/avatar/viseme-worker-protocol";

const logger = createLogger("VisemeWorker");

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function summarizePlan(
  plan: ReturnType<typeof buildGruutVisemeKeyframes>,
): GruutVisemeKeyframePlanSummary | null {
  if (!plan) return null;
  const summary = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "keyframes"),
  ) as GruutVisemeKeyframePlanSummary;
  return summary;
}

function buildResult(
  message: VisemeWorkerBuildRequest,
): VisemeWorkerBuildResult {
  const startedAt = performance.now();
  const basePlan = buildGruutVisemeKeyframes({
    phonemizedText: message.phonemizedText,
    tokenizedText: message.tokenizedText,
    fps: message.fps,
    targetDurationSec: message.targetDurationSec ?? null,
  });
  if (!basePlan) {
    throw new Error("Failed to build viseme plan from raw inputs");
  }

  let segmentTargetDurationSec: number | null = null;
  let provisionalMarginSec: number | null = null;
  let provisionalTargetDurationSec: number | null = null;
  if (message.mode === "estimated_provisional") {
    const overrun = message.provisionalOverrun;
    if (overrun) {
      provisionalMarginSec = Math.min(
        overrun.maxSec,
        Math.max(overrun.minSec, basePlan.durationSec * overrun.ratio),
      );
      provisionalTargetDurationSec =
        basePlan.durationSec + provisionalMarginSec;
      segmentTargetDurationSec = provisionalTargetDurationSec;
    }
  }

  const segment = buildVowelVisemeLipSyncSegment(message.runId, basePlan, {
    targetDurationSec: segmentTargetDurationSec,
    anchor: message.anchor ?? null,
  });
  if (!segment) {
    throw new Error("Failed to build vowel viseme lip-sync segment");
  }

  const planSummary = summarizePlan(basePlan);
  if (!planSummary) {
    throw new Error("Failed to summarize viseme plan");
  }

  const elapsedMs = Math.round(
    clamp(performance.now() - startedAt, 0, Number.MAX_SAFE_INTEGER),
  );
  return {
    planSummary,
    speechGestureTimeline: basePlan.speechGestureTimeline,
    segment,
    buildMode: message.mode,
    provisionalMarginSec,
    provisionalTargetDurationSec,
    workerElapsedMs: elapsedMs,
  };
}

function post(response: VisemeWorkerResponse): void {
  self.postMessage(response);
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as VisemeWorkerBuildRequest | undefined;
  if (!message || message.type !== "build_viseme_assets_from_raw") return;

  logger.info("Build", "Build request received", {
    requestId: message.requestId,
    runId: message.runId,
    mode: message.mode,
    targetDurationSec: message.targetDurationSec ?? null,
    hasAnchor: Boolean(message.anchor),
    hasPhonemizedText: Array.isArray(message.phonemizedText),
    phonemizedWordCount: Array.isArray(message.phonemizedText)
      ? message.phonemizedText.length
      : 0,
    hasTokenizedText: Boolean(message.tokenizedText?.trim()),
  });

  try {
    const result = buildResult(message);
    logger.info("Build", "Build request completed", {
      requestId: message.requestId,
      runId: message.runId,
      mode: result.buildMode,
      frameCount: result.segment.frameCount,
      durationMs: result.segment.durationMs,
      workerElapsedMs: result.workerElapsedMs,
      provisionalTargetDurationSec: result.provisionalTargetDurationSec,
    });
    post({
      type: "build_viseme_assets_from_raw_result",
      requestId: message.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn("Build", "Build request failed", {
      requestId: message.requestId,
      runId: message.runId,
      mode: message.mode,
      error: err.message,
    });
    post({
      type: "build_viseme_assets_from_raw_result",
      requestId: message.requestId,
      ok: false,
      error: {
        message: err.message,
        stack: err.stack,
      },
    });
  }
});

export {};
