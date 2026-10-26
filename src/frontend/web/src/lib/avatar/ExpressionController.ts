import {
  VRM,
  VRMExpressionManager,
  VRMExpressionPresetName,
} from "@pixiv/three-vrm";
import { ARKIT_BLENDSHAPES, EYE_MOVEMENT_BLENDSHAPES } from "./arkit";
import type { ArkitFaceCapability } from "./arkitFaceCapability";
import {
  arkitVowelWeights,
  shapesVowelsWithArkit,
  VOWEL5_CHANNELS,
  type Vowel5Channel,
} from "./arkitFaceCompositions";
import { registerArkitFace } from "./arkitFaceExpressions";
import { registerMorphTargetExpressions } from "./morphTargetExpressions";
import {
  fallbackPresetForPart,
  resolvePartExpressionFallbacks,
  wholeFacePresetForPart,
} from "./partExpressionFallback";
import { createLogger } from "@/lib/logger";
import {
  BLINK_CLOSE_MAX,
  BLINK_OPEN_MAX,
  TRANSITION_BLEND_WINDOW_SEC,
  IDLE_DECAY_WINDOW_SEC,
  EPS,
  type LipSyncFrameFormat,
  type EmotionLabel,
  type SegmentMeta,
  type FramePayload,
  type InternalFrame,
  type SegmentTimeline,
} from "./types";
import {
  EMOTION_INTENSITY_FALLBACK_MAP,
  EMOTION_INTENSITY_MAP,
  type EmotionExpressionComposition,
  type EmotionExpressionIntensity,
} from "./emotionExpressionPresets";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const EMOTION_FADE_SPEED = 2.0; // Increased speed for snappier expression changes
/** Presets whose presence in a Gesture hands it the whole emotional face. */
const CLIP_EMOTION_PRESETS = new Set([
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "neutral",
]);
const IGNORE_LIPSYNC_SHAPES = new Set(EYE_MOVEMENT_BLENDSHAPES);
const VOWEL5_CHANNEL_ORDER = VOWEL5_CHANNELS;
type ResolvedVowelExpressionMap = Partial<Record<Vowel5Channel, string>>;
type ExpressionOverlayMap = Map<string, number>;

/**
 * How `vowel5` lip-sync frames shape the mouth: through the Avatar's viseme
 * presets (`aa`, `ee` …), or through ARKit mouth mixes
 * (`arkitFaceCompositions.json` `vowels`) on an Avatar that has every shape
 * they use.
 */
export type LipSyncShaping = "visemes" | "arkit";
/** Mouth shapes lip sync drives, zeroed when it is cleared or switched. */
const ARKIT_MOUTH_LIPSYNC_SHAPES = ARKIT_BLENDSHAPES.filter(
  (name) =>
    name.startsWith("jaw") ||
    name.startsWith("mouth") ||
    name.startsWith("tongue"),
);

const VOWEL_EXPRESSION_CANDIDATES: Record<Vowel5Channel, string[]> = {
  A: ["aa", "a"],
  E: ["ee", "e"],
  I: ["ih", "ii", "i"],
  O: ["oh", "oo", "o"],
  U: ["ou", "uu", "u"],
};
const BLINK_CLOSE_EASE_SEC = 0.025;
const BLINK_OPEN_EASE_SEC = 0.035;
const BLINK_OPEN_MIN_SEC = 2.6;
const BLINK_DOUBLE_CHANCE = 0.25;
const BLINK_DOUBLE_WAIT_MIN_SEC = 0.12;
const BLINK_DOUBLE_WAIT_MAX_SEC = 0.28;
const BLINK_PARTIAL_CHANCE = 0.25;
const BLINK_PARTIAL_PEAK_MIN = 0.58;
const BLINK_PARTIAL_PEAK_MAX = 0.86;
const BLINK_FOLLOWUP_PEAK_MIN = 0.5;
const BLINK_FOLLOWUP_PEAK_MAX = 0.82;

// ─────────────────────────────────────────────────────────────────────────────
// AutoBlink (internal)
// ─────────────────────────────────────────────────────────────────────────────

type BlinkPhase = "waiting" | "closing" | "closed" | "opening";
type BlinkKind = "normal" | "followup";

class AutoBlink {
  private _phase: BlinkPhase = "waiting";
  private _phaseElapsedSec: number = 0;
  private _phaseDurationSec: number = 0;
  private _blinkStartBaseValue: number = 0;
  private _blinkPeakValue: number = 1;
  private _currentBlinkKind: BlinkKind = "normal";
  private _nextBlinkKind: BlinkKind = "normal";
  private _isEnabled: boolean = true;

  constructor() {
    this._scheduleNextWait();
  }

  setEnable(enabled: boolean): void {
    this._isEnabled = enabled;
  }

  /**
   * Update blink state.
   * @param delta Time delta
   * @param baseValue The "resting" blink value (e.g. 0.2 for sad eyes).
   * @returns The calculated blink weight (baseValue...1.0)
   */
  update(delta: number, baseValue: number): number {
    const safeBaseValue = clampUnit(baseValue);
    if (!this._isEnabled) return safeBaseValue;

    this._advance(sanitizeDelta(delta), safeBaseValue);
    return this._sample(safeBaseValue);
  }

  private _advance(delta: number, baseValue: number): void {
    let remainingDelta = delta;
    while (remainingDelta > 0) {
      const phaseRemainingSec = Math.max(
        0,
        this._phaseDurationSec - this._phaseElapsedSec,
      );

      if (remainingDelta < phaseRemainingSec) {
        this._phaseElapsedSec += remainingDelta;
        return;
      }

      this._phaseElapsedSec = this._phaseDurationSec;
      remainingDelta -= phaseRemainingSec;
      this._completePhase(baseValue);

      if (phaseRemainingSec === 0 && this._phaseDurationSec === 0) {
        break;
      }
    }
  }

  private _completePhase(baseValue: number): void {
    if (this._phase === "waiting") {
      this._startClosing(baseValue);
      return;
    }
    if (this._phase === "closing") {
      this._startClosed();
      return;
    }
    if (this._phase === "closed") {
      this._startOpening();
      return;
    }
    this._scheduleWaitAfterBlink();
  }

  private _sample(baseValue: number): number {
    if (this._phase === "waiting") return baseValue;
    if (this._phase === "closed") return this._blinkPeakValue;

    const progress = easedPhaseProgress(
      this._phaseElapsedSec,
      this._phaseDurationSec,
    );
    if (this._phase === "closing") {
      return lerp(this._blinkStartBaseValue, this._blinkPeakValue, progress);
    }
    return lerp(this._blinkPeakValue, baseValue, progress);
  }

  private _scheduleNextWait(): void {
    this._phase = "waiting";
    this._phaseElapsedSec = 0;
    this._phaseDurationSec = sampleNaturalBlinkWaitSec();
    this._nextBlinkKind = "normal";
  }

  private _scheduleFollowupWait(): void {
    this._phase = "waiting";
    this._phaseElapsedSec = 0;
    this._phaseDurationSec = randomRange(
      BLINK_DOUBLE_WAIT_MIN_SEC,
      BLINK_DOUBLE_WAIT_MAX_SEC,
    );
    this._nextBlinkKind = "followup";
  }

  private _scheduleWaitAfterBlink(): void {
    if (
      this._currentBlinkKind === "normal" &&
      Math.random() < BLINK_DOUBLE_CHANCE
    ) {
      this._scheduleFollowupWait();
      return;
    }
    this._scheduleNextWait();
  }

  private _startClosing(baseValue: number): void {
    this._phase = "closing";
    this._phaseElapsedSec = 0;
    this._phaseDurationSec = BLINK_CLOSE_EASE_SEC;
    this._blinkStartBaseValue = baseValue;
    this._currentBlinkKind = this._nextBlinkKind;
    this._blinkPeakValue = this._resolveBlinkPeakValue(baseValue);
  }

  private _startClosed(): void {
    this._phase = "closed";
    this._phaseElapsedSec = 0;
    this._phaseDurationSec = Math.random() * BLINK_CLOSE_MAX;
  }

  private _startOpening(): void {
    this._phase = "opening";
    this._phaseElapsedSec = 0;
    this._phaseDurationSec = BLINK_OPEN_EASE_SEC;
  }

  private _resolveBlinkPeakValue(baseValue: number): number {
    const sampledPeak =
      this._currentBlinkKind === "followup"
        ? randomRange(BLINK_FOLLOWUP_PEAK_MIN, BLINK_FOLLOWUP_PEAK_MAX)
        : Math.random() < BLINK_PARTIAL_CHANCE
          ? randomRange(BLINK_PARTIAL_PEAK_MIN, BLINK_PARTIAL_PEAK_MAX)
          : 1;

    return Math.min(1, Math.max(sampledPeak, baseValue + 0.08));
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeDelta(delta: number): number {
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return delta;
}

function easedPhaseProgress(elapsedSec: number, durationSec: number): number {
  if (durationSec <= 0) return 1;
  return easeInOutCubic(clampUnit(elapsedSec / durationSec));
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function randomRange(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}

function sampleNaturalBlinkWaitSec(): number {
  const min = Math.min(BLINK_OPEN_MIN_SEC, BLINK_OPEN_MAX);
  const max = Math.max(min, BLINK_OPEN_MAX);
  const centeredRoll = (Math.random() + Math.random()) / 2;
  return min + centeredRoll * (max - min);
}

// ─────────────────────────────────────────────────────────────────────────────
// LipSyncController (internal, per-avatar)
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger("Avatar LipSync");

function normalizeLipSyncFormat(value: unknown): LipSyncFrameFormat {
  return value === "vowel5" ? "vowel5" : "arkit_52";
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class LipSyncController {
  private _segments: SegmentTimeline[] = [];
  private _runAnchors = new Map<string, number>();
  private _lastSegmentByRun = new Map<string, string>();
  private _lastCompletedByRun = new Map<
    string,
    { endSec: number; values: number[]; format: LipSyncFrameFormat }
  >();
  private _decayByRun = new Map<
    string,
    {
      startSec: number;
      fromValues: number[];
      durationSec: number;
      format: LipSyncFrameFormat;
    }
  >();
  private _audioContext: AudioContext | null = null;
  private _segmentAudioStartedCallback:
    | ((segmentId: string, audioStartSec: number) => void)
    | null = null;

  setAudioContext(ctx: AudioContext | null): void {
    logger.info("Init", "Setting audio context");
    this._audioContext = ctx;
  }

  getAudioContext(): AudioContext | null {
    return this._audioContext;
  }

  /**
   * Set a callback to be invoked when a segment's audio starts.
   * This allows external audio worklet integration.
   */
  setSegmentAudioStartedCallback(
    cb: ((segmentId: string, audioStartSec: number) => void) | null,
  ): void {
    this._segmentAudioStartedCallback = cb;
  }

  /**
   * Called when the audio worklet signals that a segment has started playing.
   */
  onSegmentAudioStarted(segmentId: string, audioStartSec: number): void {
    this._segmentAudioStartedCallback?.(segmentId, audioStartSec);
    const segment = this._segments.find((s) => s.id === segmentId);
    if (!segment) return;

    const key = this._runKey(segment.runId);
    if (!this._runAnchors.has(key)) {
      this._runAnchors.set(key, audioStartSec);
      this._scheduleSegmentsForRun(segment.runId);
    }
  }

  initSegment(meta: SegmentMeta): void {
    const runId = meta.run_id ?? null;
    const segId =
      meta.segment_id ?? meta.job_id ?? (runId ? `run-${runId}` : "segment");

    let segment = this._segments.find((s) => s.id === segId);
    if (!segment) {
      const key = this._runKey(runId);
      const prevSegmentId = this._lastSegmentByRun.get(key) ?? null;
      // Cancel any idle decay for this run
      this._decayByRun.delete(key);

      segment = {
        id: segId,
        runId,
        prevSegmentId,
        arrivalSec: null,
        audioStartSec: null,
        durationSec: null,
        format: normalizeLipSyncFormat(meta.format),
        frames: [],
        status: "pending",
        cursorIndex: 0,
      };
      this._segments.push(segment);
      this._lastSegmentByRun.set(key, segId);
    }

    segment.format = normalizeLipSyncFormat(meta.format ?? segment.format);

    // Record arrival time
    if (segment.arrivalSec == null && this._audioContext) {
      segment.arrivalSec = this._audioContext.currentTime;
    }

    // Set duration if provided
    if (
      typeof meta.duration_seconds === "number" &&
      Number.isFinite(meta.duration_seconds)
    ) {
      segment.durationSec = meta.duration_seconds;
      this._scheduleSegmentsForRun(segment.runId);
    }
  }

  /**
   * Revise a live segment: frames at or after `fromTimeSec` are replaced by
   * `frames` (in time order), and its duration becomes `durationSec`. Playback
   * of the earlier frames is unaffected, so a planner can refine what has not
   * played yet.
   */
  replaceFramesFrom(
    segmentId: string,
    fromTimeSec: number,
    frames: readonly FramePayload[],
    durationSec: number,
  ): void {
    const segment = this._segments.find((s) => s.id === segmentId);
    if (!segment) return;
    let keep = segment.frames.length;
    while (keep > 0 && segment.frames[keep - 1]!.timeSec >= fromTimeSec - EPS) {
      keep -= 1;
    }
    segment.frames.length = keep;
    segment.cursorIndex = Math.min(segment.cursorIndex, Math.max(0, keep - 1));
    for (const frame of frames)
      this.registerFrame({ ...frame, segment_id: segmentId });
    if (Number.isFinite(durationSec) && durationSec !== segment.durationSec) {
      segment.durationSec = durationSec;
      if (segment.status === "completed") segment.status = "playing";
      this._scheduleSegmentsForRun(segment.runId);
    }
  }

  registerFrame(payload: FramePayload): void {
    const rawValues = payload.values;
    if (!Array.isArray(rawValues) || rawValues.length === 0) return;

    const values = rawValues.map((v) =>
      typeof v === "number" ? v : typeof v === "string" ? Number(v) || 0 : 0,
    );
    const timeSec =
      typeof payload.time_sec === "number" && Number.isFinite(payload.time_sec)
        ? payload.time_sec
        : 0;

    const segment = this._segments.find((s) => s.id === payload.segment_id);
    if (!segment) return;

    segment.frames.push({
      timeSec,
      values,
      format: normalizeLipSyncFormat(payload.format ?? segment.format),
    });
  }

  /**
   * Get the current lip-sync frame based on audio time.
   * Returns null if no active segment or decay.
   */
  getCurrentFrame(): InternalFrame | null {
    if (!this._audioContext) return null;

    const now = this._audioContext.currentTime;
    const frame = this._getFrameForTime(now);
    if (frame) return frame;

    // Idle decay: lerp from last completed frame to zeros
    let latestRunKey: string | null = null;
    let latestEnd = -Infinity;
    for (const [key, completed] of this._lastCompletedByRun.entries()) {
      if (completed.endSec > latestEnd) {
        latestEnd = completed.endSec;
        latestRunKey = key;
      }
    }

    if (!latestRunKey) return null;

    const completed = this._lastCompletedByRun.get(latestRunKey);
    if (!completed || !completed.values.length) return null;

    const existingDecay = this._decayByRun.get(latestRunKey);
    if (!existingDecay) {
      this._decayByRun.set(latestRunKey, {
        startSec: now,
        fromValues: completed.values,
        durationSec: IDLE_DECAY_WINDOW_SEC,
        format: completed.format,
      });
      return {
        timeSec: now,
        values: completed.values,
        format: completed.format,
      };
    }

    const elapsed = now - existingDecay.startSec;
    if (elapsed <= existingDecay.durationSec) {
      const alpha = Math.max(
        0,
        Math.min(1, elapsed / existingDecay.durationSec),
      );
      const zeros = new Array(existingDecay.fromValues.length).fill(0);
      const values = this._lerpArray(existingDecay.fromValues, zeros, alpha);
      return { timeSec: now, values, format: existingDecay.format };
    }

    // Decay completed
    this._decayByRun.delete(latestRunKey);
    this._lastCompletedByRun.delete(latestRunKey);
    return null;
  }

  clear(): void {
    this._segments.length = 0;
    this._runAnchors.clear();
    this._lastSegmentByRun.clear();
    this._lastCompletedByRun.clear();
    this._decayByRun.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _runKey(runId: string | null): string {
    return runId ?? "__no_run__";
  }

  private _scheduleSegmentsForRun(runId: string | null): void {
    const key = this._runKey(runId);
    const base = this._runAnchors.get(key);
    if (base == null) return;

    const siblings = this._segments.filter(
      (s) => s.runId === runId && s.durationSec != null,
    );
    if (!siblings.length) return;

    let currentStart = base;
    for (const seg of siblings) {
      seg.audioStartSec = currentStart;
      if (seg.arrivalSec == null) {
        seg.arrivalSec = currentStart;
      }
      if (seg.status !== "completed") {
        seg.status = "pending";
      }
      currentStart += seg.durationSec ?? 0;
    }
  }

  private _getFrameForTime(now: number): InternalFrame | null {
    // Mark segments as completed
    for (const seg of this._segments) {
      if (seg.audioStartSec == null || seg.durationSec == null) continue;
      const end = seg.audioStartSec + seg.durationSec;
      if (now > end + EPS && seg.status !== "completed") {
        seg.status = "completed";
        if (seg.format === "vowel5") {
          logger.info("LipSync", "Vowel keyframe playback completed", {
            runId: seg.runId,
            segmentId: seg.id,
            format: seg.format,
            frameCount: seg.frames.length,
            audioStartSec: seg.audioStartSec,
            durationSec: seg.durationSec,
            scheduledEndSec: end,
            completedAtSec: now,
            completionLagMs: Math.round((now - end) * 1000),
          });
        }
        if (seg.frames.length) {
          const key = this._runKey(seg.runId);
          const lastValues = seg.frames[seg.frames.length - 1]?.values ?? [];
          const existing = this._lastCompletedByRun.get(key);
          if (!existing || end > existing.endSec) {
            this._lastCompletedByRun.set(key, {
              endSec: end,
              values: lastValues,
              format: seg.format,
            });
          }
        }
      }
    }

    // Find active segment
    let active: SegmentTimeline | null = null;
    for (const seg of this._segments) {
      if (seg.audioStartSec == null || seg.durationSec == null) continue;
      const start = seg.audioStartSec;
      const end = start + seg.durationSec;
      if (now < start || now > end + EPS) continue;
      if (!active || seg.audioStartSec > (active.audioStartSec ?? 0)) {
        active = seg;
      }
    }

    if (!active || active.audioStartSec == null || active.durationSec == null) {
      return null;
    }

    const start = active.audioStartSec;
    const end = active.audioStartSec + active.durationSec;

    if (now < start || now > end + EPS) return null;

    if (active.status === "pending") {
      active.status = "playing";
    }

    // Cancel any idle decay
    this._decayByRun.delete(this._runKey(active.runId));

    const t = now - start;
    const current = this._sampleSegmentAtTime(active, t);
    if (!current) return null;

    // Smooth boundary transition
    if (t <= TRANSITION_BLEND_WINDOW_SEC && active.prevSegmentId) {
      const prev = this._segments.find((s) => s.id === active.prevSegmentId);
      if (prev?.frames.length) {
        const prevLast = prev.frames[prev.frames.length - 1]?.values ?? [];
        if (prevLast.length && prev.format === active.format) {
          const alpha = Math.max(
            0,
            Math.min(1, t / TRANSITION_BLEND_WINDOW_SEC),
          );
          const values = this._lerpArray(prevLast, current.values, alpha);
          return { timeSec: current.timeSec, values, format: current.format };
        }
      }
    }

    return current;
  }

  private _sampleSegmentAtTime(
    seg: SegmentTimeline,
    t: number,
  ): InternalFrame | null {
    const frames = seg.frames;
    if (!frames.length) return null;

    if (t <= frames[0].timeSec) {
      seg.cursorIndex = 0;
      return frames[0];
    }

    const lastIdx = frames.length - 1;
    if (t >= frames[lastIdx].timeSec) {
      seg.cursorIndex = lastIdx;
      return frames[lastIdx];
    }

    let startIdx = seg.cursorIndex;
    if (startIdx < 0 || startIdx >= lastIdx) {
      startIdx = 0;
    }

    for (let j = startIdx; j < lastIdx; j++) {
      const f0 = frames[j];
      const f1 = frames[j + 1];
      if (t < f0.timeSec || t > f1.timeSec) continue;

      const span = f1.timeSec - f0.timeSec || 1e-6;
      const alpha = Math.max(0, Math.min(1, (t - f0.timeSec) / span));
      const len = Math.min(f0.values.length, f1.values.length);
      const values: number[] = new Array(len);
      for (let k = 0; k < len; k++) {
        const v0 = f0.values[k] ?? 0;
        const v1 = f1.values[k] ?? 0;
        values[k] = v0 + (v1 - v0) * alpha;
      }
      seg.cursorIndex = j;
      return { timeSec: t, values, format: seg.format };
    }

    return null;
  }

  private _lerpArray(a: number[], b: number[], alpha: number): number[] {
    const len = Math.min(a.length, b.length);
    const out: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      const v0 = a[i] ?? 0;
      const v1 = b[i] ?? 0;
      out[i] = v0 + (v1 - v0) * alpha;
    }
    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExpressionController (main class)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExpressionController manages all facial expressions for a VRM avatar.
 *
 * Consolidates:
 * - Emotion presets (happy, sad, etc.)
 * - Auto-blink
 * - Lip-sync timeline (per-avatar, not global)
 * - Manual expression control
 */
export class ExpressionController {
  private _vrm: VRM;
  private _expressionManager: VRMExpressionManager | null;
  private _autoBlink: AutoBlink | null = null;
  private _lipSync: LipSyncController;

  // State for emotion targets
  private _currentEmotionLabel: EmotionLabel = "neutral";
  private _currentIntensity: number = 0;
  private _targetExpressions = new Map<string, number>();
  private _currentWeights = new Map<string, number>();
  private _expressionOverlays = new Map<string, ExpressionOverlayMap>();
  private _lastExpressionOverlayKeys = new Set<string>();
  /** Expressions keyed by the playing Gesture clip, with its fade weight. */
  private _clipExpressions: {
    weight: number;
    expressions: Readonly<Record<string, number>>;
  } | null = null;
  private _lastClipExpressionKeys = new Set<string>();

  private _manualTargets: Record<string, number> = {};
  private _resolvedVowelExpressions: ResolvedVowelExpressionMap = {};
  private _arkitFaceCapability: ArkitFaceCapability;
  private _lipSyncShaping: LipSyncShaping = "visemes";

  // ARKit name to VRM preset mapping (for compatibility)
  private _arkitToVrmMap: Record<string, string> = {
    eyeBlinkLeft: "blinkLeft",
    eyeBlinkRight: "blinkRight",
    jawOpen: "aa",
    mouthFunnel: "ou",
    mouthPucker: "ou",
    mouthSmileLeft: "happy",
    mouthSmileRight: "happy",
    mouthFrownLeft: "sad",
    mouthFrownRight: "sad",
    browInnerUp: "surprised",
    browOuterUpLeft: "surprised",
    browOuterUpRight: "surprised",
    browDownLeft: "angry",
    browDownRight: "angry",
    mouthSmile: "happy",
    mouthFrown: "sad",
    mouthClose: "neutral",
    mouthLowerDownLeft: "aa",
    mouthLowerDownRight: "aa",
    mouthUpperUpLeft: "ee",
    mouthUpperUpRight: "ee",
  };

  constructor(vrm: VRM) {
    this._vrm = vrm;
    this._expressionManager = vrm.expressionManager ?? null;
    this._lipSync = new LipSyncController();

    if (this._expressionManager) {
      this._autoBlink = new AutoBlink();
      this._resolvedVowelExpressions = this._detectAndLogVowelExpressions();
    }

    // Register mesh morph targets, and ARKit shapes under canonical names
    this._arkitFaceCapability = this._registerArkitExpressions();
  }

  dispose(): void {
    this.clearLipSync();
    this._expressionOverlays.clear();
    this._lastExpressionOverlayKeys.clear();
    this._clipExpressions = null;
    this._lastClipExpressionKeys.clear();
    this._autoBlink = null;
    this._targetExpressions.clear();
    this._currentWeights.clear();
    this._manualTargets = {};
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expression API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Give a playing Gesture clip's keyed expressions precedence (call each
   * frame; null when no clip plays or it keys no expressions).
   *
   * Keyed expressions blend from the composed value to the clip's value by the
   * clip's fade `weight`. If the clip keys any emotion preset, the emotion
   * system's whole contribution is faded out by the same weight so faces do
   * not mix. A keyed `blink` overrides automatic blinking the same way.
   * Lip-sync and manual overrides still apply afterwards. VRoid part keys the
   * Avatar lacks play as their mood's VRM preset (see
   * `partExpressionFallback.ts`).
   */
  setClipExpressionPrecedence(
    clip: {
      weight: number;
      expressions: Readonly<Record<string, number>>;
    } | null,
  ): void {
    this._clipExpressions =
      clip && Object.keys(clip.expressions).length > 0
        ? {
            weight: clampUnit(clip.weight),
            // Only missing VRoid parts are rewritten; other names pass through.
            expressions: resolvePartExpressionFallbacks(
              clip.expressions,
              (name) =>
                this._hasBlendshape(name) ||
                fallbackPresetForPart(name) === null,
            ),
          }
        : null;
  }

  /**
   * Set an expression value directly (for UI sliders).
   */
  setValue(name: string, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this._manualTargets[name] = clamped;

    // Apply immediately for responsive UI
    this._applyExpression(name, clamped);
  }

  /**
   * Clear a manual expression override by name.
   */
  clearValue(name: string): void {
    if (!name) return;
    const hadManualValue = Object.prototype.hasOwnProperty.call(
      this._manualTargets,
      name,
    );
    delete this._manualTargets[name];
    if (hadManualValue) {
      // Reset immediately; runtime-driven emotion/blink/lipsync can overwrite on next frame.
      this._applyExpression(name, 0);
    }
  }

  /**
   * Clear all manual expression overrides.
   */
  clearAllValues(): void {
    const keys = Object.keys(this._manualTargets);
    this._manualTargets = {};
    for (const name of keys) {
      this._applyExpression(name, 0);
    }
  }

  /**
   * Check if an expression has a manual override.
   */
  hasManualValue(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._manualTargets, name);
  }

  /**
   * Get the manual override value (if any).
   */
  getManualValue(name: string): number | null {
    const value = this._manualTargets[name];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /**
   * Get the current composed (authored) weight of an expression. The eyelid
   * closure correction scales blink morphs at manager update without changing
   * these weights.
   */
  getValue(name: string): number {
    const readLive = (key: string): number | null => {
      if (!this._expressionManager) return null;
      try {
        const value = this._expressionManager.getValue(key);
        if (typeof value === "number" && Number.isFinite(value)) {
          return Math.max(0, Math.min(1, value));
        }
      } catch {
        return null;
      }
      return null;
    };

    const direct = readLive(name);
    if (direct !== null) return direct;

    const mappedName = this._arkitToVrmMap[name];
    if (mappedName) {
      const mapped = readLive(mappedName);
      if (mapped !== null) return mapped;
    }

    return this._manualTargets[name] ?? 0;
  }

  /**
   * Play an emotion based on label and intensity.
   */
  playEmotion(label: EmotionLabel, intensity: number = 1): void {
    if (
      this._currentEmotionLabel === label &&
      this._currentIntensity === intensity
    )
      return;

    // Clamp intensity to 1, 2, 3
    const safeIntensity = Math.max(
      1,
      Math.min(3, Math.round(intensity)),
    ) as EmotionExpressionIntensity;

    logger.info("Play Emotion", "Playing emotion", {
      label,
      intensity: safeIntensity,
    });

    this._currentEmotionLabel = label;
    this._currentIntensity = safeIntensity;

    // Resolve target expressions
    const config = this._resolveEmotionTargets(label, safeIntensity);
    if (config) {
      // Clear old emotion targets
      this._targetExpressions.clear();

      // Set new targets
      for (const [name, value] of Object.entries(config) as [
        string,
        number,
      ][]) {
        this._targetExpressions.set(name, value);
      }
    } else {
      // Fallback if config missing (shouldn't happen with default map)
      this._targetExpressions.clear();
      // Try to map label directly to a preset if possible
      const fallbackPreset = resolveEmotionPreset(label);
      if (fallbackPreset !== "neutral") {
        this._targetExpressions.set(fallbackPreset, 1.0);
      }
    }
  }

  /**
   * Apply an emotion preset derived from the current EmotionLabel.
   */
  applyEmotionPreset(label: EmotionLabel, intensity: number = 1): void {
    this.playEmotion(label, intensity);
  }

  /**
   * Set an additive expression overlay owned by a runtime subsystem. Unsupported
   * expression names are ignored so clips remain portable across VRM models,
   * except VRoid part keys, which fall back to their mood's VRM preset.
   */
  setExpressionOverlay(
    ownerId: string,
    expressions: ReadonlyMap<string, number> | Record<string, number>,
  ): boolean {
    const normalizedOwnerId = ownerId.trim();
    if (!normalizedOwnerId) return false;

    const previousOverlay = this._expressionOverlays.get(normalizedOwnerId);
    if (previousOverlay) {
      for (const key of previousOverlay.keys()) {
        this._lastExpressionOverlayKeys.add(key);
      }
    }

    const overlay = this._filterSupportedExpressions(
      expressionOverlayInputToComposition(expressions),
    );
    if (!overlay.size) {
      this._expressionOverlays.delete(normalizedOwnerId);
      return false;
    }

    this._expressionOverlays.set(normalizedOwnerId, overlay);
    for (const key of overlay.keys()) {
      this._lastExpressionOverlayKeys.add(key);
    }
    return true;
  }

  clearExpressionOverlay(ownerId?: string | null): boolean {
    if (!ownerId) {
      if (this._expressionOverlays.size === 0) return false;
      for (const overlay of this._expressionOverlays.values()) {
        for (const key of overlay.keys()) {
          this._lastExpressionOverlayKeys.add(key);
        }
      }
      this._expressionOverlays.clear();
      return true;
    }

    const normalizedOwnerId = ownerId.trim();
    const overlay = this._expressionOverlays.get(normalizedOwnerId);
    if (!overlay) return false;
    for (const key of overlay.keys()) {
      this._lastExpressionOverlayKeys.add(key);
    }
    this._expressionOverlays.delete(normalizedOwnerId);
    return true;
  }

  /**
   * The ARKit face shapes this Avatar has, resolved from its morph-target names
   * at construction. Resolved shapes are registered under their canonical ARKit
   * names.
   */
  getArkitFaceCapability(): ArkitFaceCapability {
    return this._arkitFaceCapability;
  }

  /**
   * Get list of available expressions on this VRM.
   */
  getAvailableExpressions(): string[] {
    const names = new Set<string>(this._listExpressionNames());
    // An ARKit shape is listed once, under its canonical name, not also under
    // the Avatar's own spelling of it.
    for (const [canonical, morphs] of this._arkitFaceCapability?.resolved ??
      []) {
      for (const morph of morphs) if (morph !== canonical) names.delete(morph);
    }

    // Ensure common presets appear first
    const presetOrder = [
      "neutral",
      "happy",
      "angry",
      "sad",
      "relaxed",
      "surprised",
      "aa",
      "ih",
      "ou",
      "ee",
      "oh",
      "blink",
      "blinkLeft",
      "blinkRight",
      "lookUp",
      "lookDown",
      "lookLeft",
      "lookRight",
    ];

    const all = Array.from(names).sort((a, b) => a.localeCompare(b));
    const remaining = new Set(all);
    const ordered: string[] = [];
    for (const key of presetOrder) {
      if (remaining.delete(key)) ordered.push(key);
    }
    return [...ordered, ...Array.from(remaining)];
  }

  /**
   * Run synchronous rendering work with an isolated set of expression values.
   *
   * Portrait capture uses this seam instead of manual overrides so lip-sync,
   * emotion targets, auto-blink, and the user's debug overrides remain owned by
   * their normal controllers. The callback must stay synchronous: restoration
   * happens before the browser can render another frame.
   */
  runWithTemporaryValues<T>(
    values: Readonly<Record<string, number>>,
    callback: () => T,
  ): T {
    const expressionNames = this.getAvailableExpressions();
    const liveValues = new Map(
      expressionNames.map((name) => [name, this.getValue(name)] as const),
    );
    const manualTargets = { ...this._manualTargets };

    try {
      for (const name of expressionNames) {
        this._applyExpressionDirect(name, values[name] ?? 0);
      }
      this._expressionManager?.update();
      return callback();
    } finally {
      this._manualTargets = manualTargets;
      for (const [name, value] of liveValues) {
        this._applyExpressionDirect(name, value);
      }
      this._expressionManager?.update();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lip-Sync API
  // ─────────────────────────────────────────────────────────────────────────

  setAudioContext(ctx: AudioContext | null): void {
    this._lipSync.setAudioContext(ctx);
  }

  getAudioContext(): AudioContext | null {
    return this._lipSync.getAudioContext();
  }

  /**
   * Set callback for when segment audio starts (for external worklet integration).
   */
  setSegmentAudioStartedCallback(
    cb: ((segmentId: string, audioStartSec: number) => void) | null,
  ): void {
    this._lipSync.setSegmentAudioStartedCallback(cb);
  }

  /**
   * Notify that a segment's audio has started playing.
   */
  onSegmentAudioStarted(segmentId: string, audioStartSec: number): void {
    this._lipSync.onSegmentAudioStarted(segmentId, audioStartSec);
  }

  initLipSyncSegment(meta: SegmentMeta): void {
    this._lipSync.initSegment(meta);
  }

  registerLipSyncFrame(payload: FramePayload): void {
    this._lipSync.registerFrame(payload);
  }

  /** See `LipSyncController.replaceFramesFrom`. */
  replaceLipSyncFrames(
    segmentId: string,
    fromTimeSec: number,
    frames: readonly FramePayload[],
    durationSec: number,
  ): void {
    this._lipSync.replaceFramesFrom(
      segmentId,
      fromTimeSec,
      frames,
      durationSec,
    );
  }

  clearLipSync(): void {
    this._lipSync.clear();
    this._resetLipSyncExpressions();
  }

  /** Whether this Avatar has every ARKit shape the vowel mixes use. */
  canShapeLipSyncWithArkit(): boolean {
    return shapesVowelsWithArkit(this._arkitFaceCapability);
  }

  /** How `vowel5` frames shape the mouth (see `LipSyncShaping`). */
  getLipSyncShaping(): LipSyncShaping {
    return this._lipSyncShaping;
  }

  /**
   * Choose how `vowel5` frames shape the mouth. ARKit shaping falls back to
   * visemes on an Avatar without every vowel shape. Switching releases the
   * shapes the previous mode drove.
   *
   * @returns The shaping in effect.
   */
  setLipSyncShaping(shaping: LipSyncShaping): LipSyncShaping {
    const next =
      shaping === "arkit" && this.canShapeLipSyncWithArkit()
        ? "arkit"
        : "visemes";
    if (next !== this._lipSyncShaping) {
      this._lipSyncShaping = next;
      this._resetLipSyncExpressions();
    }
    return next;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Update Loop
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update expressions. Called from Avatar.update().
   */
  update(delta: number): void {
    const safeDelta = sanitizeDelta(delta);

    // 1. Calculate active targets union (active targets + currently fading out)
    const allKeys = new Set([
      ...this._targetExpressions.keys(),
      ...this._currentWeights.keys(),
    ]);

    // 2. Update weights
    for (const key of allKeys) {
      const target = this._targetExpressions.get(key) ?? 0;
      const current = this._currentWeights.get(key) ?? 0;

      if (Math.abs(current - target) < EPS) {
        if (target === 0) {
          this._currentWeights.delete(key);
          // If it's not blink (handled by AutoBlink), set to 0
          if (key !== "blink") {
            this._expressionManager?.setValue(key, 0);
          }
        } else {
          this._currentWeights.set(key, target);
        }
      } else {
        const diff = target - current;
        const step = Math.sign(diff) * EMOTION_FADE_SPEED * safeDelta;
        const next = Math.abs(diff) < Math.abs(step) ? target : current + step;
        this._currentWeights.set(key, next);
      }
    }

    const expressionOverlay = this._mergeExpressionOverlays();
    const clip = this._clipExpressions;
    const clipWeight = clip?.weight ?? 0;
    const clipKeysEmotion = Boolean(
      clip &&
      Object.keys(clip.expressions).some((key) =>
        CLIP_EMOTION_PRESETS.has(key),
      ),
    );
    const emotionScale = clipKeysEmotion ? 1 - clipWeight : 1;

    // 3. Apply emotion expressions (except blink, handled next). A playing
    // Gesture's keyed expressions take precedence over the emotion system.
    const expressionKeys = new Set([
      ...this._currentWeights.keys(),
      ...expressionOverlay.keys(),
      ...this._lastExpressionOverlayKeys,
      ...Object.keys(clip?.expressions ?? {}),
      ...this._lastClipExpressionKeys,
    ]);
    const composedWeight = (key: string): number => {
      const emotion = this._currentWeights.get(key) ?? 0;
      const clipValue = clip?.expressions[key];
      return clipValue === undefined
        ? emotion * emotionScale
        : emotion * (1 - clipWeight) + clipValue * clipWeight;
    };
    for (const key of expressionKeys) {
      if (key === "blink") continue;
      let overlay = expressionOverlay.get(key) ?? 0;
      // A VRoid part shares morphs with its mood's whole-face preset, so an
      // overlay part only fills the room that preset leaves (see
      // `wholeFacePresetForPart`), as an overlay of the preset itself would.
      const preset = overlay > 0 ? wholeFacePresetForPart(key) : null;
      if (preset && preset !== key) {
        overlay = Math.min(overlay, Math.max(0, 1 - composedWeight(preset)));
      }
      const weight = clampUnit(composedWeight(key) + overlay);
      this._expressionManager?.setValue(key, weight);
    }
    this._lastExpressionOverlayKeys = new Set(expressionOverlay.keys());
    this._lastClipExpressionKeys = new Set(
      Object.keys(clip?.expressions ?? {}),
    );

    // 4. Update AutoBlink
    // Get the base blink level from the current emotion state (e.g., sad eyes)
    const baseBlink = clampUnit(
      (this._currentWeights.get("blink") ?? 0) +
        (expressionOverlay.get("blink") ?? 0),
    );

    // AutoBlink calculates the final blink value, respecting the base level as the "open" state
    const autoBlinkValue =
      this._autoBlink?.update(delta, baseBlink) ?? baseBlink;
    const clipBlink = clip?.expressions.blink;
    const blinkValue =
      clipBlink === undefined
        ? autoBlinkValue
        : autoBlinkValue * (1 - clipWeight) + clipBlink * clipWeight;

    // Apply final blink value
    this._expressionManager?.setValue("blink", blinkValue);

    // 5. Sample lip-sync frame and apply
    const lipFrame = this._lipSync.getCurrentFrame();
    if (lipFrame) {
      if (lipFrame.format === "vowel5") {
        if (this._lipSyncShaping === "arkit") {
          this._applyVowel5ArkitFrame(lipFrame);
        } else {
          this._applyVowel5LipSyncFrame(lipFrame);
        }
      } else {
        this._applyLipSyncFrame(lipFrame);
      }
    }

    // 6. Re-apply manual debug overrides so they persist over emotion/blink/lipsync writes.
    for (const [name, value] of Object.entries(this._manualTargets)) {
      this._applyExpression(name, value);
    }

    // 7. VRM expression manager update. The manager also attenuates blink
    // channels under happy/relaxed (see eyelidClosure.ts), so the weights set
    // above stay as composed while the eyelids never close past shut.
    this._expressionManager?.update();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _listExpressionNames(): string[] {
    if (!this._expressionManager) return [];

    const names = new Set<string>();
    const manager = this._expressionManager as unknown as {
      expressions?: unknown;
      expressionMap?: unknown;
    };

    const expressionsList = Array.isArray(manager.expressions)
      ? manager.expressions
      : [];
    for (const expression of expressionsList) {
      if (!expression || typeof expression !== "object") continue;
      const record = expression as Record<string, unknown>;
      const maybeName =
        typeof record.expressionName === "string"
          ? record.expressionName
          : typeof record.name === "string"
            ? record.name
            : null;
      if (maybeName && this._hasBlendshape(maybeName)) {
        names.add(maybeName);
      }
    }

    if (isRecordLike(manager.expressionMap)) {
      for (const name of Object.keys(manager.expressionMap)) {
        if (this._hasBlendshape(name)) {
          names.add(name);
        }
      }
    }

    return Array.from(names);
  }

  private _filterSupportedExpressions(
    expressions: EmotionExpressionComposition,
  ): ExpressionOverlayMap {
    const result: ExpressionOverlayMap = new Map();
    const supported = resolvePartExpressionFallbacks(expressions, (name) =>
      this._hasBlendshape(name),
    );
    for (const [name, value] of Object.entries(supported)) {
      result.set(name, clampUnit(value));
    }
    return result;
  }

  private _mergeExpressionOverlays(): ExpressionOverlayMap {
    const merged: ExpressionOverlayMap = new Map();
    for (const overlay of this._expressionOverlays.values()) {
      for (const [name, value] of overlay.entries()) {
        merged.set(name, clampUnit((merged.get(name) ?? 0) + value));
      }
    }
    return merged;
  }

  private _resolveEmotionTargets(
    label: EmotionLabel,
    intensity: EmotionExpressionIntensity,
  ): EmotionExpressionComposition | null {
    const config = EMOTION_INTENSITY_MAP[label]?.[intensity];
    if (!config) return null;

    const fallback = EMOTION_INTENSITY_FALLBACK_MAP[label]?.[intensity];
    if (!fallback) return config;

    const configEntries = Object.entries(config);
    const primaryExpressionName = configEntries[0]?.[0] ?? null;
    if (!primaryExpressionName || !this._hasBlendshape(primaryExpressionName)) {
      return fallback;
    }

    const supportedConfig: EmotionExpressionComposition = {};
    for (const [name, value] of configEntries) {
      if (this._hasBlendshape(name)) {
        supportedConfig[name] = value;
      }
    }

    return Object.keys(supportedConfig).length > 0 ? supportedConfig : fallback;
  }

  private _detectAndLogVowelExpressions(): ResolvedVowelExpressionMap {
    const availableExpressions = this._listExpressionNames();
    const lowerToActual = new Map<string, string>();
    for (const name of availableExpressions) {
      const key = name.trim().toLowerCase();
      if (!key || lowerToActual.has(key)) continue;
      lowerToActual.set(key, name);
    }

    const resolved: ResolvedVowelExpressionMap = {};
    for (const channel of VOWEL5_CHANNEL_ORDER) {
      const candidates = VOWEL_EXPRESSION_CANDIDATES[channel];
      const match = candidates
        .map((candidate) => lowerToActual.get(candidate.toLowerCase()) ?? null)
        .find((value): value is string => typeof value === "string");
      if (match) {
        resolved[channel] = match;
      }
    }

    const vowelCandidateSet = new Set(
      VOWEL5_CHANNEL_ORDER.flatMap((channel) =>
        VOWEL_EXPRESSION_CANDIDATES[channel].map((candidate) =>
          candidate.toLowerCase(),
        ),
      ),
    );
    const availableVowelExpressions = availableExpressions.filter((name) =>
      vowelCandidateSet.has(name.toLowerCase()),
    );
    const missingVowelChannels = VOWEL5_CHANNEL_ORDER.filter(
      (channel) => !resolved[channel],
    );

    logger.info("Init", "Detected vowel expressions on VRM avatar", {
      availableExpressions,
      availableVowelExpressions,
      resolvedVowelExpressionMap: resolved,
      missingVowelChannels,
      namingStyle: this._inferVowelNamingStyle(resolved),
    });

    return resolved;
  }

  private _inferVowelNamingStyle(
    resolved: ResolvedVowelExpressionMap,
  ): "none" | "aeiou" | "vrm_preset" | "mixed" {
    const values = Object.values(resolved).map((name) => name.toLowerCase());
    if (values.length === 0) return "none";
    const aeiouSet = new Set(["a", "e", "i", "o", "u"]);
    const vrmPresetSet = new Set(["aa", "ee", "ih", "ii", "oh", "oo", "ou"]);
    const allAeiou = values.every((value) => aeiouSet.has(value));
    const allVrmPreset = values.every((value) => vrmPresetSet.has(value));
    if (allAeiou) return "aeiou";
    if (allVrmPreset) return "vrm_preset";
    return "mixed";
  }

  private _registerArkitExpressions(): ArkitFaceCapability {
    // ARKit shapes first: a mesh whose morph is already spelled canonically
    // must join the canonical expression rather than own a same-named one.
    // `Avatar.load` has usually registered them already; this is idempotent.
    const { capability, playsFacesWithArkit } = registerArkitFace(this._vrm);
    registerMorphTargetExpressions(this._vrm);
    if (capability.resolved.size > 0 || capability.ambiguous.size > 0) {
      logger.info("Init", "Detected ARKit face shapes on VRM avatar", {
        playsFacesWithArkit,
        resolved: capability.resolved.size,
        missing: capability.missing,
        ambiguous: Object.fromEntries(capability.ambiguous),
      });
    }
    return capability;
  }

  private _applyLipSyncFrame(frame: InternalFrame): void {
    if (!this._expressionManager) return;

    const count = Math.min(frame.values.length, ARKIT_BLENDSHAPES.length);
    for (let i = 0; i < count; i++) {
      const name = ARKIT_BLENDSHAPES[i];
      if (IGNORE_LIPSYNC_SHAPES.has(name)) continue;

      const value = frame.values[i];
      this._applyExpression(name, value);
    }
  }

  private _applyVowel5LipSyncFrame(frame: InternalFrame): void {
    if (!this._expressionManager) return;

    for (const expressionName of Object.values(
      this._resolvedVowelExpressions,
    )) {
      this._applyExpression(expressionName, 0);
    }

    for (let index = 0; index < VOWEL5_CHANNEL_ORDER.length; index += 1) {
      const channel = VOWEL5_CHANNEL_ORDER[index]!;
      const expressionName = this._resolvedVowelExpressions[channel];
      if (!expressionName) continue;
      const value = frame.values[index] ?? 0;
      this._applyExpression(expressionName, value);
    }
  }

  /**
   * Shape the mouth from ARKit mixes for a `vowel5` frame. Every vowel shape
   * is written each frame, so the previous frame's mouth is released; the
   * viseme presets stay at 0. Like the visemes, the shapes add to an emotion's
   * mouth rather than replacing it.
   */
  private _applyVowel5ArkitFrame(frame: InternalFrame): void {
    if (!this._expressionManager) return;
    for (const expressionName of Object.values(
      this._resolvedVowelExpressions,
    )) {
      this._applyExpression(expressionName, 0);
    }
    for (const [shape, value] of Object.entries(
      arkitVowelWeights(frame.values),
    )) {
      this._applyExpression(shape, value);
    }
  }

  private _resetLipSyncExpressions(): void {
    if (!this._expressionManager) return;

    for (const expressionName of Object.values(
      this._resolvedVowelExpressions,
    )) {
      this._applyExpressionDirect(expressionName, 0);
    }

    for (const expressionName of ARKIT_MOUTH_LIPSYNC_SHAPES) {
      this._applyExpressionDirect(expressionName, 0);
    }

    this._expressionManager.update();
  }

  private _applyExpression(name: string, value: number): void {
    if (!this._expressionManager) return;

    const clamped = Math.max(0, Math.min(1, value));

    try {
      this._expressionManager.setValue(name, clamped);
    } catch {
      // Try ARKit mapping fallback
      const vrmName = this._arkitToVrmMap[name];
      if (vrmName) {
        try {
          this._expressionManager.setValue(vrmName, clamped);
        } catch {
          // Expression not found, ignore
        }
      }
    }
  }

  private _applyExpressionDirect(name: string, value: number): void {
    if (!this._expressionManager || !name) return;
    if (!this._hasBlendshape(name)) return;

    const clamped = Math.max(0, Math.min(1, value));
    try {
      this._expressionManager.setValue(name, clamped);
    } catch {
      // Ignore missing or model-specific expression failures during cleanup.
    }
  }

  private _hasBlendshape(name: string): boolean {
    if (!this._expressionManager) return false;
    try {
      const trackName = this._expressionManager.getExpressionTrackName(name);
      return trackName !== null;
    } catch {
      return false;
    }
  }
}

function resolveEmotionPreset(label: EmotionLabel): VRMExpressionPresetName {
  switch (label) {
    case "affection":
    case "esteem":
      return "relaxed";
    case "delight":
    case "drive":
      return "happy";
    case "gloom":
      return "sad";
    case "rejection":
      return "angry";
    case "revulsion":
      return "angry";
    case "alarm":
      return "surprised";
    case "neutral":
    default:
      return "neutral";
  }
}

function expressionOverlayInputToComposition(
  input: ReadonlyMap<string, number> | Record<string, number>,
): EmotionExpressionComposition {
  const entries =
    input instanceof Map ? input.entries() : Object.entries(input);
  const composition: EmotionExpressionComposition = {};
  for (const [name, value] of entries) {
    if (!name.trim() || !Number.isFinite(value)) continue;
    composition[name] = value;
  }
  return composition;
}
