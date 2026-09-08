import type { TalkingHandsProceduralAnimationParams } from "./types";
import type { SpeechGestureBeat } from "@/lib/speech/gruut-viseme-keyframes";
import type { TtsChunkBoundaryType } from "@/lib/speech/tts-chunker";

const EPSILON = 0.0001;
const MIN_SEGMENT_DURATION_SEC = 0.03;
const TALKING_HANDS_MIN_SPEECH_DURATION_SEC = 1.2;
const TALKING_HANDS_MIN_REMAINING_TO_START_SEC = 0.8;
const DEFAULT_TALKING_HANDS_GESTURE_ENTRY_SEC = 0.56;
const DEFAULT_TALKING_HANDS_GESTURE_ENTRY_GRACE_SEC = 0.08;
const DEFAULT_TALKING_HANDS_GESTURE_RETURN_SEC = 0.56;
const DEFAULT_TALKING_HANDS_BEAT_PULSE_ATTACK_SEC = 0.08;
const DEFAULT_TALKING_HANDS_BEAT_PULSE_RELEASE_SEC = 0.1;
const DEFAULT_TALKING_HANDS_BEAT_MIN_SPACING_SEC = 0.18;

export type TalkingHandsSpeechPlanStatus = "ready" | "skipped" | "waiting";
export type TalkingHandsSpeechSelectedSide = "left" | "right" | "both";

export type TalkingHandsSpeechPlanScope = "utterance" | "chunk";

export type TalkingHandsSpeechPlanSkipReason =
  | "empty_beat_timeline"
  | "insufficient_remaining"
  | "invalid_duration"
  | "no_usable_beats"
  | "non_positive_speed"
  | "short_utterance"
  | "zero_pulse_count";

export type TalkingHandsSpeechChunkStatus = "pending" | "played" | "skipped";

export type TalkingHandsSpeechChunkSkipReason =
  | "missing_beat_timeline"
  | "no_primary_beats"
  | "no_usable_beats"
  | "planner_skipped"
  | "random_skip";

export type TalkingHandsSpeechPlanSkippedBeatReason =
  | "after_window_end"
  | "exceeds_max_pulse_count"
  | "too_close_to_previous_beat"
  | "too_early_for_gesture_entry";

export type TalkingHandsSpeechPlanBeatDiagnostic = {
  timeSec: number;
  wordIndex: number;
  phonemeIndex: number;
  phoneme: string;
};

export type TalkingHandsSpeechPlanSkippedBeatDiagnostic =
  TalkingHandsSpeechPlanBeatDiagnostic & {
    reason: TalkingHandsSpeechPlanSkippedBeatReason;
  };

export type TalkingHandsSpeechPlanPulseDiagnostic = {
  beat: TalkingHandsSpeechPlanBeatDiagnostic;
  beatTimeSec: number;
  apexTimeSec: number;
  driftSec: number;
  pulseScale: number;
};

export type TalkingHandsSpeechPlanSegment =
  | {
      kind: "base";
      durationSec: number;
      startSec: number;
      endSec: number;
    }
  | {
      kind: "neutral";
      durationSec: number;
      startSec: number;
      endSec: number;
    }
  | {
      kind: "pulse";
      durationSec: number;
      startSec: number;
      endSec: number;
      beat: SpeechGestureBeat;
      apexTimeSec: number;
      apexDriftSec: number;
      pulseScale: number;
    };

type TalkingHandsSpeechPlanSegmentDraft =
  | {
      kind: "base";
      durationSec: number;
    }
  | {
      kind: "neutral";
      durationSec: number;
    }
  | {
      kind: "pulse";
      durationSec: number;
      beat: SpeechGestureBeat;
      apexTimeSec: number;
      apexDriftSec: number;
      pulseScale: number;
    };

export type TalkingHandsSpeechPlanDiagnostics = {
  runId: string;
  scope: TalkingHandsSpeechPlanScope;
  selectedSide: TalkingHandsSpeechSelectedSide | null;
  elapsedSec: number;
  utteranceDurationSec: number;
  windowEndSec: number;
  remainingSec: number;
  returnStartSec: number;
  maxPulseCount: number;
  gestureEntrySec: number;
  gestureEntryGraceSec: number;
  gestureReturnSec: number;
  minSpacingSec: number;
  pulseAttackSec: number;
  pulseReleaseSec: number;
  selectedBeats: TalkingHandsSpeechPlanBeatDiagnostic[];
  skippedBeats: TalkingHandsSpeechPlanSkippedBeatDiagnostic[];
  pulseApexes: TalkingHandsSpeechPlanPulseDiagnostic[];
};

export type TalkingHandsSpeechPlanReplayRequest = {
  source: "speech";
  runId: string;
  elapsedSec: number;
  durationSec: number;
  scope?: TalkingHandsSpeechPlanScope;
  windowEndSec?: number | null;
  selectedSide?: TalkingHandsSpeechSelectedSide | null;
  beats: readonly SpeechGestureBeat[];
};

export type TalkingHandsSpeechChunkDiagnostic = {
  runId: string;
  chunkId: string;
  index: number;
  preview: string;
  boundaryType: TtsChunkBoundaryType;
  isExclamation: boolean;
  wordStartIndex: number;
  wordEndIndex: number;
  status: TalkingHandsSpeechChunkStatus;
  skipReason?: TalkingHandsSpeechChunkSkipReason;
  selectedSide?: TalkingHandsSpeechSelectedSide;
  beatCount: number;
  selectedBeats: TalkingHandsSpeechPlanBeatDiagnostic[];
  skippedBeats: TalkingHandsSpeechPlanSkippedBeatDiagnostic[];
  pulseApexes: TalkingHandsSpeechPlanPulseDiagnostic[];
};

export type TalkingHandsSpeechPlanDebugSnapshot = {
  status: TalkingHandsSpeechPlanStatus;
  reason?: TalkingHandsSpeechPlanSkipReason | "missing_beat_timeline";
  diagnostics: TalkingHandsSpeechPlanDiagnostics;
  chunks?: TalkingHandsSpeechChunkDiagnostic[];
  replayRequest?: TalkingHandsSpeechPlanReplayRequest;
};

type TalkingHandsSpeechPlanBase = {
  status: TalkingHandsSpeechPlanStatus;
  diagnostics: TalkingHandsSpeechPlanDiagnostics;
};

export type TalkingHandsSpeechPlanReady = TalkingHandsSpeechPlanBase & {
  status: "ready";
  selectedBeats: SpeechGestureBeat[];
  segments: TalkingHandsSpeechPlanSegment[];
};

export type TalkingHandsSpeechPlanSkipped = TalkingHandsSpeechPlanBase & {
  status: "skipped";
  reason: TalkingHandsSpeechPlanSkipReason;
};

export type TalkingHandsSpeechPlanWaiting = TalkingHandsSpeechPlanBase & {
  status: "waiting";
  reason: "missing_beat_timeline";
};

export type TalkingHandsSpeechPlan =
  | TalkingHandsSpeechPlanReady
  | TalkingHandsSpeechPlanSkipped
  | TalkingHandsSpeechPlanWaiting;

export type CreateTalkingHandsSpeechPlanInput = {
  runId: string;
  elapsedSec: number;
  utteranceDurationSec: number;
  scope?: TalkingHandsSpeechPlanScope;
  windowEndSec?: number | null;
  selectedSide?: TalkingHandsSpeechSelectedSide | null;
  remainingSec: number;
  beats: readonly SpeechGestureBeat[] | null;
  params: TalkingHandsProceduralAnimationParams;
};

type SelectedBeatEntry = {
  beat: SpeechGestureBeat;
};

export function createTalkingHandsSpeechPlan(
  input: CreateTalkingHandsSpeechPlanInput,
): TalkingHandsSpeechPlan {
  const elapsedSec = sanitizeNonNegativeFinite(input.elapsedSec);
  const utteranceDurationSec = sanitizeNonNegativeFinite(
    input.utteranceDurationSec,
  );
  const remainingSec = sanitizeNonNegativeFinite(input.remainingSec);
  const scope = input.scope ?? "utterance";
  const gestureEntrySec = sanitizePositiveFinite(
    input.params.speechGestureEntrySec,
    DEFAULT_TALKING_HANDS_GESTURE_ENTRY_SEC,
  );
  const gestureEntryGraceSec = sanitizeNonNegativeFiniteWithFallback(
    input.params.speechGestureEntryGraceSec,
    DEFAULT_TALKING_HANDS_GESTURE_ENTRY_GRACE_SEC,
  );
  const gestureReturnSec = sanitizePositiveFinite(
    input.params.speechGestureReturnSec,
    DEFAULT_TALKING_HANDS_GESTURE_RETURN_SEC,
  );
  const minSpacingSec = sanitizePositiveFinite(
    input.params.speechBeatMinSpacingSec,
    DEFAULT_TALKING_HANDS_BEAT_MIN_SPACING_SEC,
  );
  const pulseAttackSec = sanitizePositiveFinite(
    input.params.speechBeatPulseAttackSec,
    DEFAULT_TALKING_HANDS_BEAT_PULSE_ATTACK_SEC,
  );
  const pulseReleaseSec = sanitizePositiveFinite(
    input.params.speechBeatPulseReleaseSec,
    DEFAULT_TALKING_HANDS_BEAT_PULSE_RELEASE_SEC,
  );
  const windowEndSec = Math.min(
    utteranceDurationSec,
    sanitizePositiveFinite(input.windowEndSec, utteranceDurationSec),
  );
  const returnStartSec = Math.max(0, windowEndSec - gestureReturnSec);
  const maxPulseCount = Math.max(0, Math.round(input.params.microBendCount));
  const diagnostics = createDiagnostics({
    runId: input.runId,
    scope,
    selectedSide: input.selectedSide ?? null,
    elapsedSec,
    utteranceDurationSec,
    windowEndSec,
    remainingSec,
    returnStartSec,
    maxPulseCount,
    gestureEntrySec,
    gestureEntryGraceSec,
    gestureReturnSec,
    minSpacingSec,
    pulseAttackSec,
    pulseReleaseSec,
  });

  if (
    !Number.isFinite(input.utteranceDurationSec) ||
    input.utteranceDurationSec <= 0
  ) {
    return createSkippedPlan(diagnostics, "invalid_duration");
  }
  if (input.params.speed <= 0) {
    return createSkippedPlan(diagnostics, "non_positive_speed");
  }
  if (
    scope === "utterance" &&
    utteranceDurationSec < TALKING_HANDS_MIN_SPEECH_DURATION_SEC
  ) {
    return createSkippedPlan(diagnostics, "short_utterance");
  }
  if (
    scope === "utterance" &&
    remainingSec < TALKING_HANDS_MIN_REMAINING_TO_START_SEC
  ) {
    return createSkippedPlan(diagnostics, "insufficient_remaining");
  }
  if (!input.beats) {
    return {
      status: "waiting",
      reason: "missing_beat_timeline",
      diagnostics,
    };
  }
  if (input.beats.length === 0) {
    return createSkippedPlan(diagnostics, "empty_beat_timeline");
  }
  if (maxPulseCount <= 0) {
    diagnostics.skippedBeats = input.beats.map((beat) => ({
      ...createBeatDiagnostic(beat),
      reason: "exceeds_max_pulse_count",
    }));
    return createSkippedPlan(diagnostics, "zero_pulse_count");
  }

  const selectedBeats = selectSpeechGestureBeats({
    beats: input.beats,
    elapsedSec,
    availableEndSec: windowEndSec,
    maxCount: maxPulseCount,
    gestureEntrySec,
    gestureEntryGraceSec,
    minSpacingSec,
    diagnostics,
  });
  if (selectedBeats.length === 0) {
    return createSkippedPlan(diagnostics, "no_usable_beats");
  }

  const segments = createPlanSegments({
    elapsedSec,
    returnStartSec,
    beats: selectedBeats,
    gestureEntrySec,
    gestureReturnSec,
    pulseAttackSec,
    pulseReleaseSec,
    diagnostics,
  });
  const finalReturnSegment = segments[segments.length - 1];
  if (finalReturnSegment?.kind === "neutral") {
    diagnostics.returnStartSec = finalReturnSegment.startSec;
  }

  diagnostics.selectedBeats = selectedBeats.map(createBeatDiagnostic);
  return {
    status: "ready",
    selectedBeats,
    segments,
    diagnostics,
  };
}

export function createTalkingHandsSpeechPlanDebugSnapshot(
  plan: TalkingHandsSpeechPlan,
  chunks: readonly TalkingHandsSpeechChunkDiagnostic[] = [],
): TalkingHandsSpeechPlanDebugSnapshot {
  const base = {
    status: plan.status,
    diagnostics: plan.diagnostics,
    chunks: chunks.slice(),
  };

  if (plan.status === "ready") {
    return {
      ...base,
      replayRequest: {
        source: "speech",
        runId: plan.diagnostics.runId,
        elapsedSec: plan.diagnostics.elapsedSec,
        durationSec: plan.diagnostics.utteranceDurationSec,
        scope: plan.diagnostics.scope,
        windowEndSec: plan.diagnostics.windowEndSec,
        selectedSide: plan.diagnostics.selectedSide,
        beats: plan.selectedBeats,
      },
    };
  }

  return {
    ...base,
    reason: plan.reason,
  };
}

function createDiagnostics({
  runId,
  scope,
  selectedSide,
  elapsedSec,
  utteranceDurationSec,
  windowEndSec,
  remainingSec,
  returnStartSec,
  maxPulseCount,
  gestureEntrySec,
  gestureEntryGraceSec,
  gestureReturnSec,
  minSpacingSec,
  pulseAttackSec,
  pulseReleaseSec,
}: {
  runId: string;
  scope: TalkingHandsSpeechPlanScope;
  selectedSide: TalkingHandsSpeechSelectedSide | null;
  elapsedSec: number;
  utteranceDurationSec: number;
  windowEndSec: number;
  remainingSec: number;
  returnStartSec: number;
  maxPulseCount: number;
  gestureEntrySec: number;
  gestureEntryGraceSec: number;
  gestureReturnSec: number;
  minSpacingSec: number;
  pulseAttackSec: number;
  pulseReleaseSec: number;
}): TalkingHandsSpeechPlanDiagnostics {
  return {
    runId,
    scope,
    selectedSide,
    elapsedSec,
    utteranceDurationSec,
    windowEndSec,
    remainingSec,
    returnStartSec,
    maxPulseCount,
    gestureEntrySec,
    gestureEntryGraceSec,
    gestureReturnSec,
    minSpacingSec,
    pulseAttackSec,
    pulseReleaseSec,
    selectedBeats: [],
    skippedBeats: [],
    pulseApexes: [],
  };
}

function createSkippedPlan(
  diagnostics: TalkingHandsSpeechPlanDiagnostics,
  reason: TalkingHandsSpeechPlanSkipReason,
): TalkingHandsSpeechPlanSkipped {
  return {
    status: "skipped",
    reason,
    diagnostics,
  };
}

function selectSpeechGestureBeats({
  beats,
  elapsedSec,
  availableEndSec,
  maxCount,
  gestureEntrySec,
  gestureEntryGraceSec,
  minSpacingSec,
  diagnostics,
}: {
  beats: readonly SpeechGestureBeat[];
  elapsedSec: number;
  availableEndSec: number;
  maxCount: number;
  gestureEntrySec: number;
  gestureEntryGraceSec: number;
  minSpacingSec: number;
  diagnostics: TalkingHandsSpeechPlanDiagnostics;
}): SpeechGestureBeat[] {
  const firstUsableBeatSec =
    elapsedSec + Math.max(0, gestureEntrySec - gestureEntryGraceSec);
  const candidates: SpeechGestureBeat[] = [];

  for (const beat of [...beats].sort(compareSpeechGestureBeatsByTime)) {
    if (beat.timeSec < firstUsableBeatSec) {
      diagnostics.skippedBeats.push({
        ...createBeatDiagnostic(beat),
        reason: "too_early_for_gesture_entry",
      });
      continue;
    }
    if (beat.timeSec > availableEndSec + EPSILON) {
      diagnostics.skippedBeats.push({
        ...createBeatDiagnostic(beat),
        reason: "after_window_end",
      });
      continue;
    }
    candidates.push(beat);
  }

  const spacedSelected: SelectedBeatEntry[] = [];
  candidates.forEach((beat) => {
    const previous = spacedSelected[spacedSelected.length - 1];
    if (previous && beat.timeSec - previous.beat.timeSec < minSpacingSec) {
      diagnostics.skippedBeats.push({
        ...createBeatDiagnostic(beat),
        reason: "too_close_to_previous_beat",
      });
      return;
    }

    spacedSelected.push({
      beat,
    });
  });

  if (spacedSelected.length <= maxCount) {
    return spacedSelected.map((entry) => entry.beat);
  }

  const kept = spacedSelected.slice(0, maxCount);
  const keptKeys = new Set(
    kept.map((entry) => createSpeechBeatKey(entry.beat)),
  );

  for (const entry of spacedSelected) {
    const beatKey = createSpeechBeatKey(entry.beat);
    if (keptKeys.has(beatKey)) continue;
    diagnostics.skippedBeats.push({
      ...createBeatDiagnostic(entry.beat),
      reason: "exceeds_max_pulse_count",
    });
  }

  return kept.map((entry) => entry.beat).sort(compareSpeechGestureBeatsByTime);
}

function createPlanSegments({
  elapsedSec,
  returnStartSec,
  beats,
  gestureEntrySec,
  gestureReturnSec,
  pulseAttackSec,
  pulseReleaseSec,
  diagnostics,
}: {
  elapsedSec: number;
  returnStartSec: number;
  beats: readonly SpeechGestureBeat[];
  gestureEntrySec: number;
  gestureReturnSec: number;
  pulseAttackSec: number;
  pulseReleaseSec: number;
  diagnostics: TalkingHandsSpeechPlanDiagnostics;
}): TalkingHandsSpeechPlanSegment[] {
  const segments: TalkingHandsSpeechPlanSegment[] = [];
  let cursorSec = elapsedSec;

  const appendSegment = (segment: TalkingHandsSpeechPlanSegmentDraft): void => {
    const startSec = cursorSec;
    const durationSec = Math.max(0, segment.durationSec);
    const advancesTime = durationSec >= MIN_SEGMENT_DURATION_SEC;
    const endSec = advancesTime ? startSec + durationSec : startSec;
    segments.push({
      ...segment,
      durationSec,
      startSec,
      endSec,
    });
    if (advancesTime) {
      cursorSec = endSec;
    }
  };

  beats.forEach((beat, index) => {
    const attackStartSec =
      index === 0
        ? Math.max(cursorSec, beat.timeSec - gestureEntrySec)
        : Math.max(cursorSec, beat.timeSec - pulseAttackSec);
    appendSegment({
      kind: index === 0 ? "neutral" : "base",
      durationSec: Math.max(0, attackStartSec - cursorSec),
    });

    const pulseStartSec = cursorSec;
    const attackDurationSec = Math.max(0, beat.timeSec - cursorSec);
    const apexTimeSec = Math.max(pulseStartSec, beat.timeSec);
    const pulseScale = 1;
    appendSegment({
      kind: "pulse",
      durationSec: attackDurationSec,
      beat,
      apexTimeSec,
      apexDriftSec: apexTimeSec - beat.timeSec,
      pulseScale,
    });
    cursorSec = Math.max(cursorSec, beat.timeSec);
    diagnostics.pulseApexes.push({
      beat: createBeatDiagnostic(beat),
      beatTimeSec: beat.timeSec,
      apexTimeSec,
      driftSec: apexTimeSec - beat.timeSec,
      pulseScale,
    });

    const nextBeat = beats[index + 1] ?? null;
    const nextAttackStartSec = nextBeat
      ? Math.min(
          returnStartSec,
          Math.max(cursorSec, nextBeat.timeSec - pulseAttackSec),
        )
      : returnStartSec;
    const releaseBudgetSec = Math.max(0, nextAttackStartSec - cursorSec);
    appendSegment({
      kind: "base",
      durationSec: Math.min(pulseReleaseSec, releaseBudgetSec),
    });
    appendSegment({
      kind: "base",
      durationSec: Math.max(0, nextAttackStartSec - cursorSec),
    });
  });

  appendSegment({
    kind: "base",
    durationSec: Math.max(0, returnStartSec - cursorSec),
  });
  appendSegment({
    kind: "neutral",
    durationSec: gestureReturnSec,
  });

  return segments;
}

function createBeatDiagnostic(
  beat: SpeechGestureBeat,
): TalkingHandsSpeechPlanBeatDiagnostic {
  return {
    timeSec: beat.timeSec,
    wordIndex: beat.wordIndex,
    phonemeIndex: beat.phonemeIndex,
    phoneme: beat.phoneme,
  };
}

function compareSpeechGestureBeatsByTime(
  left: SpeechGestureBeat,
  right: SpeechGestureBeat,
): number {
  return left.timeSec - right.timeSec;
}

function createSpeechBeatKey(beat: SpeechGestureBeat): string {
  return [beat.wordIndex, beat.phonemeIndex, beat.timeSec.toFixed(3)].join(":");
}

function sanitizeNonNegativeFinite(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function sanitizePositiveFinite(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function sanitizeNonNegativeFiniteWithFallback(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}
