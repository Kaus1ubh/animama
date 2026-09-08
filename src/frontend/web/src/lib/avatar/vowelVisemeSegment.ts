import type { GruutVisemeKeyframePlan } from "@/lib/speech/gruut-viseme-keyframes";
import type { FramePayload, SegmentMeta } from "./types";

export const VOWEL5_FRAME_VALUES_ORDER = ["A", "E", "I", "O", "U"] as const;

export type Vowel5FrameValues = [number, number, number, number, number];

export type VowelVisemeLipSyncSegment = {
  segmentId: string;
  meta: SegmentMeta;
  frames: FramePayload[];
  frameCount: number;
  durationMs: number;
  durationSec: number;
  fps: number;
};

export type BuildVowelVisemeLipSyncSegmentOptions = {
  targetDurationSec?: number | null;
  anchor?: {
    elapsedSec: number;
    currentDurationSec: number;
    currentValues: Vowel5FrameValues;
  } | null;
};

const EPS = 1e-6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function normalizeDurationSec(
  value: number | null | undefined,
  fallbackSec: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallbackSec;
  }
  return Math.max(1 / 60, value);
}

function normalizeFps(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 60;
  }
  return Math.max(1, Math.round(value));
}

function lerp(a: number, b: number, alpha: number): number {
  const t = clamp01(alpha);
  return a + (b - a) * t;
}

function normalizeValues(values: Vowel5FrameValues): Vowel5FrameValues {
  const clamped: Vowel5FrameValues = [
    clamp01(values[0] ?? 0),
    clamp01(values[1] ?? 0),
    clamp01(values[2] ?? 0),
    clamp01(values[3] ?? 0),
    clamp01(values[4] ?? 0),
  ];
  const sum = clamped[0] + clamped[1] + clamped[2] + clamped[3] + clamped[4];
  if (sum <= 1 || sum <= EPS) return clamped;
  return [
    clamped[0] / sum,
    clamped[1] / sum,
    clamped[2] / sum,
    clamped[3] / sum,
    clamped[4] / sum,
  ];
}

function valuesFromPlanFrame(
  frame: GruutVisemeKeyframePlan["keyframes"][number],
): Vowel5FrameValues {
  return normalizeValues([frame.A, frame.E, frame.I, frame.O, frame.U]);
}

function samplePlanValuesAtTime(
  plan: GruutVisemeKeyframePlan,
  timeSec: number,
): Vowel5FrameValues {
  const frames = plan.keyframes;
  if (!Array.isArray(frames) || frames.length === 0) {
    return [0, 0, 0, 0, 0];
  }

  const t = clamp(timeSec, 0, Math.max(0, plan.durationSec));
  const first = frames[0]!;
  if (t <= first.timeSec + EPS) {
    return valuesFromPlanFrame(first);
  }

  const last = frames[frames.length - 1]!;
  if (t >= last.timeSec - EPS) {
    return valuesFromPlanFrame(last);
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const f0 = frames[index]!;
    const f1 = frames[index + 1]!;
    if (t < f0.timeSec - EPS || t > f1.timeSec + EPS) continue;
    const span = Math.max(EPS, f1.timeSec - f0.timeSec);
    const alpha = (t - f0.timeSec) / span;
    const v0 = valuesFromPlanFrame(f0);
    const v1 = valuesFromPlanFrame(f1);
    return normalizeValues([
      lerp(v0[0], v1[0], alpha),
      lerp(v0[1], v1[1], alpha),
      lerp(v0[2], v1[2], alpha),
      lerp(v0[3], v1[3], alpha),
      lerp(v0[4], v1[4], alpha),
    ]);
  }

  return valuesFromPlanFrame(last);
}

function samplePlanValuesAtNormalizedProgress(
  plan: GruutVisemeKeyframePlan,
  progress: number,
): Vowel5FrameValues {
  const durationSec = Math.max(EPS, plan.durationSec);
  const t = clamp01(progress) * durationSec;
  return samplePlanValuesAtTime(plan, t);
}

function mapTargetTimeToSourceProgress(args: {
  targetTimeSec: number;
  targetDurationSec: number;
  anchor?: BuildVowelVisemeLipSyncSegmentOptions["anchor"];
}): number {
  const { targetTimeSec, targetDurationSec, anchor } = args;
  if (!anchor) {
    if (targetDurationSec <= EPS) return 1;
    return clamp01(targetTimeSec / targetDurationSec);
  }

  const anchorElapsedSec = clamp(
    anchor.elapsedSec,
    0,
    Math.max(0, targetDurationSec),
  );
  const currentDurationSec = Math.max(EPS, anchor.currentDurationSec);
  const anchorProgress = clamp01(anchorElapsedSec / currentDurationSec);

  if (anchorElapsedSec <= EPS) {
    const remainingTarget = Math.max(EPS, targetDurationSec);
    return clamp01(
      anchorProgress + (1 - anchorProgress) * (targetTimeSec / remainingTarget),
    );
  }

  if (targetTimeSec <= anchorElapsedSec) {
    return clamp01(anchorProgress * (targetTimeSec / anchorElapsedSec));
  }

  const remainingTarget = targetDurationSec - anchorElapsedSec;
  if (remainingTarget <= EPS) return 1;
  const after = (targetTimeSec - anchorElapsedSec) / remainingTarget;
  return clamp01(anchorProgress + (1 - anchorProgress) * after);
}

function createFramesForDuration(args: {
  runId: string;
  segmentId: string;
  plan: GruutVisemeKeyframePlan;
  durationSec: number;
  fps: number;
  anchor?: BuildVowelVisemeLipSyncSegmentOptions["anchor"];
}): FramePayload[] {
  const { runId, segmentId, plan, durationSec, fps, anchor } = args;
  const frameCount = Math.max(1, Math.round(durationSec * fps));

  const frames: FramePayload[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const timeSec = frameIndex / fps;
    const progress = mapTargetTimeToSourceProgress({
      targetTimeSec: timeSec,
      targetDurationSec: durationSec,
      anchor,
    });
    const values = samplePlanValuesAtNormalizedProgress(plan, progress);
    frames.push({
      run_id: runId,
      segment_id: segmentId,
      frame_index: frameIndex,
      time_sec: timeSec,
      format: "vowel5",
      values,
    });
  }

  if (
    anchor &&
    Number.isFinite(anchor.elapsedSec) &&
    anchor.elapsedSec > 0 &&
    anchor.elapsedSec < durationSec
  ) {
    frames.push({
      run_id: runId,
      segment_id: segmentId,
      frame_index: frames.length,
      time_sec: anchor.elapsedSec,
      format: "vowel5",
      values: normalizeValues(anchor.currentValues),
    });
  }

  frames.sort((a, b) => {
    const ta = typeof a.time_sec === "number" ? a.time_sec : 0;
    const tb = typeof b.time_sec === "number" ? b.time_sec : 0;
    return ta - tb;
  });

  return frames.map((frame, frameIndex) => ({
    ...frame,
    frame_index: frameIndex,
  }));
}

export function buildVowelVisemeLipSyncSegment(
  runId: string,
  plan: GruutVisemeKeyframePlan,
  options?: BuildVowelVisemeLipSyncSegmentOptions,
): VowelVisemeLipSyncSegment | null {
  if (
    !runId ||
    !plan ||
    !Array.isArray(plan.keyframes) ||
    plan.keyframes.length === 0
  ) {
    return null;
  }

  const segmentId = `viseme-${runId}`;
  const durationSec = normalizeDurationSec(
    options?.targetDurationSec,
    Math.max(1 / 60, plan.durationSec),
  );
  const fps = normalizeFps(plan.fps);

  const frames = createFramesForDuration({
    runId,
    segmentId,
    plan,
    durationSec,
    fps,
    anchor: options?.anchor ?? null,
  });

  const meta: SegmentMeta = {
    run_id: runId,
    segment_id: segmentId,
    duration_seconds: durationSec,
    format: "vowel5",
  };

  return {
    segmentId,
    meta,
    frames,
    frameCount: frames.length,
    durationMs: Math.round(durationSec * 1000),
    durationSec,
    fps,
  };
}
