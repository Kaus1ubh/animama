import type {
  ActiveAnimationInfo,
  AnimationLoopType,
  AvatarAnimationState,
  AvatarThinkingPoseClipId,
  EmotionalState,
} from "../types";
import {
  type ManifestGestureEntry,
  type ManifestGestureType,
  type ManifestIdleCandidateDebug,
  type ManifestAnimation,
} from "../animationManifest";
import type { ProceduralAnimationLayerId } from "../ProceduralAnimationController";
import {
  isEmotionPostureGroup,
  type EmotionPostureGroup,
} from "../proc-animation/types";
import {
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipPlaybackLifetimeActive,
  type AnyAnimaPoseClip,
} from "../poses/animaPoseClip";
import { selectThinkingPoseClip } from "../thinkingPoseSelection";
import type { NormalizedEmotionReactionIntensity } from "../reactionClips";
import {
  BUILT_IN_AVATAR_MOTION_CATALOG,
  type AvatarMotionCatalog,
} from "../motion/AvatarMotionCatalog";
import type { AvatarInteractionPhase } from "@/lib/types/voice-types";

export type AvatarPlannerLane =
  | "baseVrma"
  | "gestureVrma"
  | "poseClip"
  | "procedural"
  | "reactionClip";
export type AvatarPlannerGestureResolutionSource = "manifest";

export type AvatarPlannerEnterPolicy =
  | { mode: "fadeIn"; durationSec: number }
  | { mode: "crossfade"; durationSec: number };

export type AvatarPlannerExitPolicy = { mode: "fadeOut"; durationSec: number };

export type AvatarPlannerVrma = {
  ownerId: string;
  lane: Extract<AvatarPlannerLane, "baseVrma" | "gestureVrma">;
  key: string;
  contextKey: string;
  state: AvatarAnimationState;
  gestureRequestId: string | null;
  sourceMotionEventId: string | null;
  sourceEmotionEventId: string | null;
  clip: ManifestAnimation | null;
  clipName: string | null;
  clipUrl: string | null;
  loopType: AnimationLoopType;
  loopCount?: number;
  timeScale: number;
  crossFadeSec: number;
  isGesture: boolean;
  durationSec: number | null;
  effectiveDurationSec: number | null;
  nextEvalMs: number | null;
  startedAtMs: number;
  expiresAtMs: number | null;
  emotionKey: string;
  emotionIntensity: number;
  manifestGestureId: string | null;
  manifestGestureType: ManifestGestureType | null;
  gestureResolutionSource: AvatarPlannerGestureResolutionSource | null;
};

export type AvatarPlannerIdleStintPhase = "quiet" | "active";

export type AvatarPlannerIdleStintState = {
  phase: AvatarPlannerIdleStintPhase;
  quietStartedAtMs: number | null;
  activeStartedAtMs: number | null;
  activePlanKey: string | null;
  lastSelectedFile: string | null;
  nextDueAtMs: number | null;
};

export type AvatarPlannerIdleStintDebugSnapshot = {
  phase: AvatarPlannerIdleStintPhase;
  quietIntervalSec: number;
  quietStartedAtMs: number | null;
  activeStartedAtMs: number | null;
  nextDueAtMs: number | null;
  nextEvalMs: number | null;
  selectedCandidate: ManifestIdleCandidateDebug | null;
  eligibleCandidateCount: number;
  candidates: ManifestIdleCandidateDebug[];
};

export type AvatarPlannerPoseClipStatus = "pending" | "active";
export type AvatarPlannerPoseClipSource = "thinking" | "gesture" | "idle";

export type AvatarPlannerPoseClip = {
  ownerId: string;
  requestId: string;
  runId: string;
  clipId: AvatarThinkingPoseClipId | string;
  source: AvatarPlannerPoseClipSource;
  finitePlayback?: {
    timeScale: number;
    repetitions: number;
    durationSec: number;
  };
  manifestGestureId: string | null;
  manifestGestureType: ManifestGestureType | null;
  gestureResolutionSource: AvatarPlannerGestureResolutionSource | null;
  sourceMotionEventId: string | null;
  sourceEmotionEventId: string | null;
  status: AvatarPlannerPoseClipStatus;
  requestedAtMs: number;
  eligibleAtMs: number;
  startedAtMs: number | null;
  /** Hard end for Gesture clips so authored loops cannot pin a chat run. */
  expiresAtMs: number | null;
  priority: number;
  enterPolicy: AvatarPlannerEnterPolicy;
  exitPolicy: AvatarPlannerExitPolicy;
};

export type AvatarPlannerProceduralPolicy =
  | "listening"
  | "talking"
  | "emotionPosture";

export type AvatarPlannerEmotionPostureConfig = {
  plannerEnabled: boolean;
  presetEnabledByGroup: Partial<Record<EmotionPostureGroup, boolean>>;
};

export type AvatarPlannerProceduralStint = {
  ownerId: string;
  policy: AvatarPlannerProceduralPolicy;
  layerId: ProceduralAnimationLayerId | null;
  startedAtMs: number;
  enabled: boolean;
};

export type AvatarPlannerTalkingMotionArbitrationStatus =
  | "inactive"
  | "awaitingEmotionUpdate"
  | "talkingHandsAllowed"
  | "manifestAnimationRequested";

export type AvatarPlannerTalkingMotionArbitration = {
  runId: string | null;
  status: AvatarPlannerTalkingMotionArbitrationStatus;
  sourceMotionEventId: string | null;
  sourceEmotionEventId: string | null;
  animationHint: string | null;
};

export type AvatarPlannerVrmaDebugSnapshot = {
  ownerId: string;
  lane: Extract<AvatarPlannerLane, "baseVrma" | "gestureVrma">;
  key: string;
  contextKey: string;
  state: AvatarAnimationState;
  gestureRequestId: string | null;
  sourceMotionEventId: string | null;
  sourceEmotionEventId: string | null;
  clipName: string | null;
  clipUrl: string | null;
  loopType: AnimationLoopType;
  loopCount?: number;
  timeScale: number;
  durationSec: number | null;
  effectiveDurationSec: number | null;
  nextEvalMs: number | null;
  startedAtMs: number;
  expiresAtMs: number | null;
  emotionKey: string;
  emotionIntensity: number;
  manifestGestureId: string | null;
  manifestGestureType: ManifestGestureType | null;
  gestureResolutionSource: AvatarPlannerGestureResolutionSource | null;
};

export type AvatarPlannerTalkingMotionSource =
  | "pending"
  | "manifestGesture"
  | "talkingHands"
  | "none";

export type AvatarPlannerResolvedGestureDebugSnapshot = {
  id: string;
  type: ManifestGestureType;
  source: AvatarPlannerGestureResolutionSource;
  requestId: string | null;
  clipId: string | null;
};

export type AvatarPlannerRunStartedEvent = {
  type: "runStarted";
  eventId: string;
  runId: string;
  inputText: string;
  createdAtMs: number;
  thinkingPoseDwellMs?: number | null;
};

export type AvatarPlannerGestureEvent = {
  type: "gestureRequested";
  eventId: string;
  requestId: string;
  runId: string | null;
  animationHint: string | null;
  sourceEventId: string | null;
  sourceEmotionEventId: string | null;
  createdAtMs: number;
};

export type AvatarPlannerEmotionEvent = {
  type: "emotionUpdated";
  eventId: string;
  emotionEventId: string | null;
  runId: string | null;
  animationHint: string | null;
  createdAtMs: number;
};

type AvatarPlannerMotionEvent =
  | AvatarPlannerRunStartedEvent
  | AvatarPlannerGestureEvent
  | AvatarPlannerEmotionEvent;

export type AvatarPlannerEmotionReactionEvent = {
  type: "emotionReactionUpdated";
  eventId: string;
  emotionEventId: string | null;
  runId: string | null;
  emotional_tone: string | null;
  emotional_intensity: NormalizedEmotionReactionIntensity;
  createdAtMs: number;
};

export type AvatarPlannerEvent =
  | AvatarPlannerMotionEvent
  | AvatarPlannerEmotionReactionEvent;

export type AvatarPlannerPendingEventDebugSnapshot =
  | {
      type: "runStarted";
      eventId: string;
      runId: string;
      createdAtMs: number;
      inputTextLength: number;
      thinkingPoseDwellMs: number | null;
    }
  | {
      type: "gestureRequested";
      eventId: string;
      requestId: string;
      runId: string | null;
      createdAtMs: number;
      animationHint: string | null;
      sourceEventId: string | null;
      sourceEmotionEventId: string | null;
    }
  | {
      type: "emotionUpdated";
      eventId: string;
      emotionEventId: string | null;
      runId: string | null;
      animationHint: string | null;
      createdAtMs: number;
    };

type AvatarPlannerMotionState = {
  animaId: string | null;
  activeRunId: string | null;
  interactionPhase: AvatarInteractionPhase | null;
  phaseEnteredAtMs: number | null;
  activeBaseVrma: AvatarPlannerVrma | null;
  activeGestureVrma: AvatarPlannerVrma | null;
  activePlannerPoseClip: AvatarPlannerPoseClip | null;
  idleStint: AvatarPlannerIdleStintState;
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
  pendingEvents: AvatarPlannerMotionEvent[];
  proceduralStints: AvatarPlannerProceduralStint[];
  lastCancellationReason: string | null;
};

type AvatarPlannerMotionInput = {
  nowMs: number;
  animaId: string | null;
  activeRunId: string | null;
  interactionPhase: AvatarInteractionPhase;
  avatarState: AvatarAnimationState;
  emotionalState: EmotionalState;
  activeVrmaActions: readonly ActiveAnimationInfo[];
  activePlannerPoseClip: AvatarPlannerPoseClip | null;
  manualPoseClipActive: boolean;
  /** Manual automatic-playback suspension also prevents idle clip admission. */
  idlePlaybackBlocked?: boolean;
  plannerPoseClipRuntimeActive?: boolean;
  activePlannerProceduralLayerIds: readonly ProceduralAnimationLayerId[];
  manualProceduralLayerIds: readonly ProceduralAnimationLayerId[];
  eligiblePlannerProceduralLayerIds: readonly ProceduralAnimationLayerId[];
  pendingEvents: readonly AvatarPlannerMotionEvent[];
  randomRolls?: readonly number[];
  idleStintQuietIntervalSec?: number;
  emotionPostureConfig?: AvatarPlannerEmotionPostureConfig;
  motionCatalog?: AvatarMotionCatalog;
};

type AvatarPlannerMotionAction =
  | {
      type: "playVrmaLoop";
      ownerId: string;
      lane: "baseVrma";
      plan: AvatarPlannerVrma;
      clipName: string;
      clipUrl: string;
      transition: AvatarPlannerEnterPolicy;
    }
  | {
      type: "stopVrmaLoop";
      ownerId: string;
      lane: "baseVrma";
      plan: AvatarPlannerVrma;
      clipName: string;
      reason: string;
      transition: AvatarPlannerExitPolicy;
    }
  | {
      type: "playVrmaGesture";
      ownerId: string;
      lane: "gestureVrma";
      requestId: string;
      plan: AvatarPlannerVrma;
      clipName: string;
      clipUrl: string;
      transition: AvatarPlannerEnterPolicy;
    }
  | {
      type: "playPoseClip";
      ownerId: string;
      lane: "poseClip";
      runId: string;
      clipId: string;
      poseClip: AvatarPlannerPoseClip;
      transition: AvatarPlannerEnterPolicy;
    }
  | {
      type: "stopPoseClip";
      ownerId: string;
      lane: "poseClip";
      clipId: string;
      reason: string;
      transition: AvatarPlannerExitPolicy;
    }
  | {
      type: "setProceduralPolicy";
      ownerId: string;
      lane: "procedural";
      layerId: ProceduralAnimationLayerId;
      enabled: boolean;
    };

export type AvatarPlannerDebugSnapshot = {
  evaluatedAtMs: number;
  animaId: string | null;
  activeRunId: string | null;
  interactionPhase: AvatarInteractionPhase;
  avatarState: AvatarAnimationState;
  baseState: AvatarAnimationState;
  phaseEnteredAtMs: number | null;
  emotionKey: string;
  emotionIntensity: number;
  activeBaseVrma: AvatarPlannerVrmaDebugSnapshot | null;
  activeGestureVrma: AvatarPlannerVrmaDebugSnapshot | null;
  idleStint: AvatarPlannerIdleStintDebugSnapshot;
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
  activeBaseVrmaKey: string | null;
  activeGestureVrmaKey: string | null;
  activePoseClip: AvatarPlannerPoseClip | null;
  activeReactionClip: AvatarPlannerReactionClip | null;
  resolvedGesture: AvatarPlannerResolvedGestureDebugSnapshot | null;
  talkingMotionSource: AvatarPlannerTalkingMotionSource;
  talkingHandsBypassed: boolean;
  pendingEvents: AvatarPlannerPendingEventDebugSnapshot[];
  pendingReactionClipEvents: AvatarPlannerEmotionReactionEvent[];
  pendingEventCount: number;
  pendingGestureEventCount: number;
  pendingReactionClipEventCount: number;
  lastReactionClipEventKey: string | null;
  activeVrmaActionNames: string[];
  activePlannerProceduralLayerIds: ProceduralAnimationLayerId[];
  manualProceduralLayerIds: ProceduralAnimationLayerId[];
  proceduralStints: AvatarPlannerProceduralStint[];
  actionTypes: AvatarPlannerAction["type"][];
  consumedPlannerEventIds: string[];
  ignoredEventReasons: string[];
  randomRollsConsumed: number;
  lastCancellationReason: string | null;
};

type AvatarPlannerMotionOutput = {
  state: AvatarPlannerMotionState;
  actions: AvatarPlannerMotionAction[];
  consumedPlannerEventIds: string[];
  debug: AvatarPlannerDebugSnapshot;
};

export type AvatarPlannerReactionClip = {
  ownerId: string;
  sourceEventId: string;
  emotionEventId: string | null;
  runId: string;
  emotionalTone: string | null;
  emotionalIntensity: Exclude<NormalizedEmotionReactionIntensity, 0>;
  clipId: string;
  startedAtMs: number;
};

export type AvatarPlannerState = AvatarPlannerMotionState & {
  activeReactionClip: AvatarPlannerReactionClip | null;
  pendingReactionClipEvents: AvatarPlannerEmotionReactionEvent[];
  lastReactionClipEventKey: string | null;
};

export type AvatarPlannerInput = Omit<
  AvatarPlannerMotionInput,
  "pendingEvents"
> & {
  pendingEvents: readonly AvatarPlannerEvent[];
};

export type AvatarPlannerReactionClipAction =
  | {
      type: "playReactionClip";
      lane: "reactionClip";
      ownerId: string;
      runId: string;
      sourceEventId: string;
      emotionEventId: string | null;
      emotionalTone: string | null;
      emotionalIntensity: Exclude<NormalizedEmotionReactionIntensity, 0>;
      clipId: string;
    }
  | {
      type: "clearReactionClip";
      lane: "reactionClip";
      ownerId: string;
      runId: string | null;
      reason: string;
    };

export type AvatarPlannerAction =
  | AvatarPlannerMotionAction
  | AvatarPlannerReactionClipAction;

export type AvatarPlannerOutput = Omit<
  AvatarPlannerMotionOutput,
  "state" | "actions"
> & {
  state: AvatarPlannerState;
  actions: AvatarPlannerAction[];
};

const DEFAULT_CROSSFADE_SEC = 2;
const GESTURE_CROSSFADE_SEC = 1.0;
const DEFAULT_GESTURE_DURATION_SEC = 2;
export const DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC = 180;
export const NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS = 5000;
const TRANSITION_BUFFER_SEC = 0.15;
const DEFAULT_THINKING_POSE_DWELL_MS = 600;
const MAX_PENDING_MOTION_EVENTS = 12;
const MAX_PENDING_REACTION_CLIP_EVENTS = 12;
const THINKING_POSE_OWNER_ID = "state:thinking";
const THINKING_POSE_PRIORITY = 10;
const LISTENING_PROCEDURAL_OWNER_ID = "state:listening:procedural";
const TALKING_PROCEDURAL_OWNER_ID = "state:talking:procedural";
const EMOTION_POSTURE_PROCEDURAL_OWNER_ID = "state:emotionPosture:procedural";
const LISTENING_BOUNCE_CHANCE = 0.4;
const LISTENING_HEAD_NOD_CHANCE = 0.4;

type AvatarPlannerResolvedVrmaGesture = {
  kind: "vrma";
  plan: AvatarPlannerVrma;
  requestId: string;
};

type AvatarPlannerResolvedPoseGesture = {
  kind: "poseClip";
  poseClip: AvatarPlannerPoseClip;
};

type AvatarPlannerResolvedGesture =
  | AvatarPlannerResolvedVrmaGesture
  | AvatarPlannerResolvedPoseGesture;

/**
 * Stateless facade for avatar presentation planning. Callers own the returned
 * state and pass it back on the next evaluation.
 */
export class AvatarPlanner {
  private readonly motionCatalog: AvatarMotionCatalog;

  constructor(
    motionCatalog: AvatarMotionCatalog = BUILT_IN_AVATAR_MOTION_CATALOG,
  ) {
    this.motionCatalog = motionCatalog;
  }

  createInitialState(): AvatarPlannerState {
    return createInitialAvatarPlannerState();
  }

  plan(
    previous: AvatarPlannerState,
    input: AvatarPlannerInput,
  ): AvatarPlannerOutput {
    return planAvatar(previous, {
      ...input,
      motionCatalog: input.motionCatalog ?? this.motionCatalog,
    });
  }
}

function createInitialAvatarPlannerMotionState(): AvatarPlannerMotionState {
  return {
    animaId: null,
    activeRunId: null,
    interactionPhase: null,
    phaseEnteredAtMs: null,
    activeBaseVrma: null,
    activeGestureVrma: null,
    activePlannerPoseClip: null,
    idleStint: createInitialIdleStintState(),
    talkingMotionArbitration: createInactiveTalkingMotionArbitration(),
    pendingEvents: [],
    proceduralStints: [],
    lastCancellationReason: null,
  };
}

export function createInitialAvatarPlannerState(): AvatarPlannerState {
  return {
    ...createInitialAvatarPlannerMotionState(),
    activeReactionClip: null,
    pendingReactionClipEvents: [],
    lastReactionClipEventKey: null,
  };
}

function createInitialIdleStintState(): AvatarPlannerIdleStintState {
  return {
    phase: "quiet",
    quietStartedAtMs: null,
    activeStartedAtMs: null,
    activePlanKey: null,
    lastSelectedFile: null,
    nextDueAtMs: null,
  };
}

function createInactiveTalkingMotionArbitration(): AvatarPlannerTalkingMotionArbitration {
  return {
    runId: null,
    status: "inactive",
    sourceMotionEventId: null,
    sourceEmotionEventId: null,
    animationHint: null,
  };
}

function createAwaitingTalkingMotionArbitration(
  runId: string,
): AvatarPlannerTalkingMotionArbitration {
  return {
    runId,
    status: "awaitingEmotionUpdate",
    sourceMotionEventId: null,
    sourceEmotionEventId: null,
    animationHint: null,
  };
}

function normalizeTalkingMotionArbitration(
  previous: AvatarPlannerTalkingMotionArbitration | undefined,
  activeRunId: string | null,
): AvatarPlannerTalkingMotionArbitration {
  if (!activeRunId) {
    return createInactiveTalkingMotionArbitration();
  }
  if (previous?.runId === activeRunId && previous.status !== "inactive") {
    return { ...previous };
  }
  return createAwaitingTalkingMotionArbitration(activeRunId);
}

export function planAvatar(
  previous: AvatarPlannerState,
  input: AvatarPlannerInput,
): AvatarPlannerOutput {
  const motionCatalog = input.motionCatalog ?? BUILT_IN_AVATAR_MOTION_CATALOG;
  const resolvedInput = { ...input, motionCatalog };
  const baseline =
    previous.animaId === input.animaId
      ? previous
      : createInitialAvatarPlannerState();
  const incomingMotionEvents = input.pendingEvents.filter(
    isAvatarPlannerMotionEvent,
  );
  const incomingReactionClipEvents = input.pendingEvents.filter(
    isEmotionReactionUpdatedEvent,
  );
  const motionOutput = planAvatarMotion(baseline, {
    ...resolvedInput,
    pendingEvents: incomingMotionEvents,
  });
  const reactionClipOutput = planReactionClip({
    previous,
    input: resolvedInput,
    incomingEvents: incomingReactionClipEvents,
  });
  const actions: AvatarPlannerAction[] = [
    ...motionOutput.actions,
    ...reactionClipOutput.actions,
  ];
  const state: AvatarPlannerState = {
    ...motionOutput.state,
    activeReactionClip: reactionClipOutput.activeReactionClip,
    pendingReactionClipEvents: reactionClipOutput.pendingReactionClipEvents,
    lastReactionClipEventKey: reactionClipOutput.lastReactionClipEventKey,
  };
  const consumedPlannerEventIds = [
    ...motionOutput.consumedPlannerEventIds,
    ...reactionClipOutput.consumedEventIds,
  ];

  return {
    ...motionOutput,
    state,
    actions,
    consumedPlannerEventIds,
    debug: {
      ...motionOutput.debug,
      activeReactionClip: reactionClipOutput.activeReactionClip
        ? { ...reactionClipOutput.activeReactionClip }
        : null,
      pendingReactionClipEvents:
        reactionClipOutput.pendingReactionClipEvents.map((event) => ({
          ...event,
        })),
      pendingReactionClipEventCount:
        reactionClipOutput.pendingReactionClipEvents.length,
      lastReactionClipEventKey: reactionClipOutput.lastReactionClipEventKey,
      actionTypes: actions.map((action) => action.type),
      consumedPlannerEventIds,
    },
  };
}

function planReactionClip(args: {
  previous: AvatarPlannerState;
  input: AvatarPlannerInput;
  incomingEvents: readonly AvatarPlannerEmotionReactionEvent[];
}): {
  activeReactionClip: AvatarPlannerReactionClip | null;
  pendingReactionClipEvents: AvatarPlannerEmotionReactionEvent[];
  lastReactionClipEventKey: string | null;
  actions: AvatarPlannerReactionClipAction[];
  consumedEventIds: string[];
} {
  const motionCatalog =
    args.input.motionCatalog ?? BUILT_IN_AVATAR_MOTION_CATALOG;
  const actions: AvatarPlannerReactionClipAction[] = [];
  const consumedEventIds: string[] = [];
  const sameAnima = args.previous.animaId === args.input.animaId;
  let activeReactionClip = sameAnima ? args.previous.activeReactionClip : null;
  let lastReactionClipEventKey = sameAnima
    ? args.previous.lastReactionClipEventKey
    : null;
  const pendingEvents = mergeReactionClipEvents(
    sameAnima ? args.previous.pendingReactionClipEvents : [],
    args.incomingEvents,
  );

  if (!sameAnima && args.previous.activeReactionClip) {
    actions.push({
      type: "clearReactionClip",
      lane: "reactionClip",
      ownerId: args.previous.activeReactionClip.ownerId,
      runId: args.previous.activeReactionClip.runId,
      reason: "animaChanged",
    });
  }

  if (
    activeReactionClip &&
    !isActiveReactionClipLifetimeActive(activeReactionClip, args.input)
  ) {
    actions.push({
      type: "clearReactionClip",
      lane: "reactionClip",
      ownerId: activeReactionClip.ownerId,
      runId: activeReactionClip.runId,
      reason: getReactionClipLifetimeEndReason(activeReactionClip, args.input),
    });
    activeReactionClip = null;
  }

  const retainedEvents: AvatarPlannerEmotionReactionEvent[] = [];
  for (const event of pendingEvents) {
    if (!args.input.activeRunId || !event.runId) {
      consumedEventIds.push(event.eventId);
      continue;
    }
    if (event.runId !== args.input.activeRunId) {
      consumedEventIds.push(event.eventId);
      continue;
    }
    const reactionEventKey = getReactionClipEventKey(event);
    if (
      lastReactionClipEventKey !== null &&
      reactionEventKey === lastReactionClipEventKey
    ) {
      consumedEventIds.push(event.eventId);
      continue;
    }
    const reactionRuntimeId = motionCatalog.getReactionRuntimeId({
      emotionalTone: event.emotional_tone,
      emotionalIntensity: event.emotional_intensity,
    });
    const selectedClip = reactionRuntimeId
      ? motionCatalog.getReactionClip(reactionRuntimeId)
      : null;
    if (
      reactionRuntimeId &&
      !isReactionClipStartLifetimeActive(selectedClip, event.runId, args.input)
    ) {
      retainedEvents.push(event);
      continue;
    }

    consumedEventIds.push(event.eventId);
    lastReactionClipEventKey = reactionEventKey;
    if (!reactionRuntimeId) continue;
    if (event.emotional_intensity === 0) continue;

    const nextReactionClip: AvatarPlannerReactionClip = {
      ownerId: `emotionReaction:${event.runId}:${event.eventId}`,
      sourceEventId: event.eventId,
      emotionEventId: event.emotionEventId,
      runId: event.runId,
      emotionalTone: event.emotional_tone,
      emotionalIntensity: event.emotional_intensity,
      clipId: reactionRuntimeId,
      startedAtMs: args.input.nowMs,
    };
    activeReactionClip = nextReactionClip;
    actions.push({
      type: "playReactionClip",
      lane: "reactionClip",
      ownerId: nextReactionClip.ownerId,
      runId: nextReactionClip.runId,
      sourceEventId: nextReactionClip.sourceEventId,
      emotionEventId: nextReactionClip.emotionEventId,
      emotionalTone: nextReactionClip.emotionalTone,
      emotionalIntensity: nextReactionClip.emotionalIntensity,
      clipId: nextReactionClip.clipId,
    });
  }

  return {
    activeReactionClip,
    pendingReactionClipEvents: retainedEvents,
    lastReactionClipEventKey,
    actions,
    consumedEventIds,
  };
}

function isReactionClipStartLifetimeActive(
  clip: AnyAnimaPoseClip | null,
  runId: string | null,
  input: AvatarPlannerInput,
): boolean {
  if (!clip?.playback) {
    return isAssistantPresentationPhase(input.interactionPhase);
  }
  return isAnimaPoseClipPlaybackLifetimeActive(clip.playback, {
    interactionPhase: input.interactionPhase,
    avatarState: input.avatarState,
    activeRunId: input.activeRunId,
    ownerRunId: runId,
  });
}

function isActiveReactionClipLifetimeActive(
  activeReactionClip: AvatarPlannerReactionClip,
  input: AvatarPlannerInput,
): boolean {
  if (activeReactionClip.runId !== input.activeRunId) return false;
  if (
    input.interactionPhase === "responding_no_tts" &&
    input.nowMs - activeReactionClip.startedAtMs >=
      NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS
  ) {
    return false;
  }

  const clip =
    input.motionCatalog?.getReactionClip(activeReactionClip.clipId) ?? null;

  if (!clip?.playback) {
    return isAssistantPresentationPhase(input.interactionPhase);
  }
  return isAnimaPoseClipPlaybackLifetimeActive(clip.playback, {
    interactionPhase: input.interactionPhase,
    avatarState: input.avatarState,
    activeRunId: input.activeRunId,
    ownerRunId: activeReactionClip.runId,
  });
}

function getReactionClipLifetimeEndReason(
  activeReactionClip: AvatarPlannerReactionClip,
  input: AvatarPlannerInput,
): string {
  if (activeReactionClip.runId !== input.activeRunId) return "runChanged";
  if (
    input.interactionPhase === "responding_no_tts" &&
    input.nowMs - activeReactionClip.startedAtMs >=
      NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS
  ) {
    return "nonTtsReactionDurationElapsed";
  }

  const clip =
    input.motionCatalog?.getReactionClip(activeReactionClip.clipId) ?? null;
  if (
    clip?.playback?.lifetime.kind === "whileInteractionPhase" &&
    clip.playback.lifetime.phases.includes("talking")
  ) {
    return "talkingEnded";
  }

  return "lifetimeEnded";
}

function mergeReactionClipEvents(
  retainedEvents: readonly AvatarPlannerEmotionReactionEvent[],
  incomingEvents: readonly AvatarPlannerEmotionReactionEvent[],
): AvatarPlannerEmotionReactionEvent[] {
  const byId = new Map<string, AvatarPlannerEmotionReactionEvent>();
  for (const event of retainedEvents) {
    byId.set(event.eventId, event);
  }
  for (const event of incomingEvents) {
    byId.set(event.eventId, event);
  }
  const sortedEvents = Array.from(byId.values()).sort(
    (left, right) => left.createdAtMs - right.createdAtMs,
  );
  if (sortedEvents.length <= MAX_PENDING_REACTION_CLIP_EVENTS) {
    return sortedEvents;
  }
  return sortedEvents.slice(
    sortedEvents.length - MAX_PENDING_REACTION_CLIP_EVENTS,
  );
}

function getReactionClipEventKey(
  event: AvatarPlannerEmotionReactionEvent,
): string {
  return `${event.runId ?? "global"}:${event.emotionEventId ?? event.eventId}`;
}

function isAvatarPlannerMotionEvent(
  event: AvatarPlannerEvent,
): event is AvatarPlannerMotionEvent {
  return event.type !== "emotionReactionUpdated";
}

function isEmotionReactionUpdatedEvent(
  event: AvatarPlannerEvent,
): event is AvatarPlannerEmotionReactionEvent {
  return event.type === "emotionReactionUpdated";
}

/**
 * Pure reducer-style planner for state-triggered avatar motion decisions.
 */
function planAvatarMotion(
  previous: AvatarPlannerMotionState,
  input: AvatarPlannerMotionInput,
): AvatarPlannerMotionOutput {
  const baselineRaw =
    previous.animaId === input.animaId
      ? previous
      : createInitialAvatarPlannerMotionState();
  const baseline: AvatarPlannerMotionState = {
    ...baselineRaw,
    talkingMotionArbitration: normalizeTalkingMotionArbitration(
      baselineRaw.talkingMotionArbitration,
      input.activeRunId,
    ),
  };
  const phaseEnteredAtMs =
    baseline.interactionPhase === input.interactionPhase
      ? (baseline.phaseEnteredAtMs ?? input.nowMs)
      : input.nowMs;
  const baseState = resolveBaseState(input.interactionPhase);
  const emotionKey = input.emotionalState.dominantGroup;
  const emotionIntensity =
    input.emotionalState.dominantGroupSummary?.intensity ?? 1;
  const random = createRandomRollReader(input.randomRolls);
  const consumedPlannerEventIds: string[] = [];
  const ignoredEventReasons: string[] = [];
  const pendingEvents = mergeAvatarPlannerMotionEvents(
    baseline.pendingEvents,
    input.pendingEvents,
  );

  const vrma = planVrma({
    previous: baseline,
    input,
    baseState,
    emotionKey,
    emotionIntensity,
    pendingEvents,
    talkingMotionArbitration: baseline.talkingMotionArbitration,
    nextRandomRoll: random.next,
    consumedPlannerEventIds,
    ignoredEventReasons,
  });

  const pose = planPoseClip({
    previous: baseline,
    input,
    pendingEvents: vrma.pendingEvents,
    gesturePoseClip: vrma.gesturePoseClip,
    idlePoseClip: vrma.idlePoseClip,
    interruptIdle: !!vrma.activeGestureVrma || !!vrma.gesturePoseClip,
    phaseEnteredAtMs,
    nextRandomRoll: random.next,
    consumedPlannerEventIds,
    ignoredEventReasons,
  });

  const procedural = planProcedural({
    previous: baseline,
    input,
    baseState,
    manifestGestureActive: Boolean(
      vrma.activeGestureVrma?.manifestGestureId ||
      isGesturePoseClip(pose.activePlannerPoseClip),
    ),
    talkingMotionArbitration: vrma.talkingMotionArbitration,
    nextRandomRoll: random.next,
  });

  const actions = [...vrma.actions, ...pose.actions, ...procedural.actions];
  const nextState: AvatarPlannerMotionState = {
    animaId: input.animaId,
    activeRunId: input.activeRunId,
    interactionPhase: input.interactionPhase,
    phaseEnteredAtMs,
    activeBaseVrma: vrma.activeBaseVrma,
    activeGestureVrma: vrma.activeGestureVrma,
    activePlannerPoseClip: pose.activePlannerPoseClip,
    idleStint: vrma.idleStint,
    talkingMotionArbitration: vrma.talkingMotionArbitration,
    pendingEvents: pose.pendingEvents,
    proceduralStints: procedural.proceduralStints,
    lastCancellationReason:
      pose.lastCancellationReason ?? vrma.lastCancellationReason,
  };

  return {
    state: nextState,
    actions,
    consumedPlannerEventIds,
    debug: {
      evaluatedAtMs: input.nowMs,
      animaId: input.animaId,
      activeRunId: input.activeRunId,
      interactionPhase: input.interactionPhase,
      avatarState: input.avatarState,
      baseState,
      phaseEnteredAtMs,
      emotionKey,
      emotionIntensity,
      activeBaseVrma: toVrmaDebugSnapshot(nextState.activeBaseVrma),
      activeGestureVrma: toVrmaDebugSnapshot(nextState.activeGestureVrma),
      idleStint: vrma.idleStintDebug,
      talkingMotionArbitration: { ...nextState.talkingMotionArbitration },
      activeBaseVrmaKey: nextState.activeBaseVrma?.key ?? null,
      activeGestureVrmaKey: nextState.activeGestureVrma?.key ?? null,
      activePoseClip: nextState.activePlannerPoseClip,
      activeReactionClip: null,
      resolvedGesture: resolveActiveGestureDebugSnapshot(nextState),
      talkingMotionSource: resolveTalkingMotionSource({
        input,
        state: nextState,
      }),
      talkingHandsBypassed:
        input.interactionPhase === "talking" &&
        Boolean(
          nextState.activeGestureVrma?.manifestGestureId ||
          isGesturePoseClip(nextState.activePlannerPoseClip) ||
          nextState.talkingMotionArbitration.status ===
            "manifestAnimationRequested",
        ) &&
        canEnablePlannerProceduralLayer("talkingHands", input),
      pendingEvents: nextState.pendingEvents.map(toPendingEventDebugSnapshot),
      pendingReactionClipEvents: [],
      pendingEventCount: nextState.pendingEvents.length,
      pendingGestureEventCount: nextState.pendingEvents.filter(
        (event) => event.type === "gestureRequested",
      ).length,
      pendingReactionClipEventCount: 0,
      lastReactionClipEventKey: null,
      activeVrmaActionNames: input.activeVrmaActions.map((item) => item.name),
      activePlannerProceduralLayerIds: [
        ...input.activePlannerProceduralLayerIds,
      ],
      manualProceduralLayerIds: [...input.manualProceduralLayerIds],
      proceduralStints: nextState.proceduralStints.map((stint) => ({
        ...stint,
      })),
      actionTypes: actions.map((action) => action.type),
      consumedPlannerEventIds,
      ignoredEventReasons,
      randomRollsConsumed: random.consumed(),
      lastCancellationReason: nextState.lastCancellationReason,
    },
  };
}

function mergeAvatarPlannerMotionEvents(
  retainedEvents: readonly AvatarPlannerMotionEvent[],
  incomingEvents: readonly AvatarPlannerMotionEvent[],
): AvatarPlannerMotionEvent[] {
  const byId = new Map<string, AvatarPlannerMotionEvent>();
  for (const event of retainedEvents) {
    byId.set(event.eventId, event);
  }
  for (const event of incomingEvents) {
    byId.set(event.eventId, event);
  }
  const sortedEvents = Array.from(byId.values()).sort(
    (left, right) => left.createdAtMs - right.createdAtMs,
  );
  if (sortedEvents.length <= MAX_PENDING_MOTION_EVENTS) {
    return sortedEvents;
  }
  return sortedEvents.slice(sortedEvents.length - MAX_PENDING_MOTION_EVENTS);
}

function toVrmaDebugSnapshot(
  plan: AvatarPlannerVrma | null,
): AvatarPlannerVrmaDebugSnapshot | null {
  if (!plan) return null;
  return {
    ownerId: plan.ownerId,
    lane: plan.lane,
    key: plan.key,
    contextKey: plan.contextKey,
    state: plan.state,
    gestureRequestId: plan.gestureRequestId,
    sourceMotionEventId: plan.sourceMotionEventId,
    sourceEmotionEventId: plan.sourceEmotionEventId,
    clipName: plan.clipName,
    clipUrl: plan.clipUrl,
    loopType: plan.loopType,
    loopCount: plan.loopCount,
    timeScale: plan.timeScale,
    durationSec: plan.durationSec,
    effectiveDurationSec: plan.effectiveDurationSec,
    nextEvalMs: plan.nextEvalMs,
    startedAtMs: plan.startedAtMs,
    expiresAtMs: plan.expiresAtMs,
    emotionKey: plan.emotionKey,
    emotionIntensity: plan.emotionIntensity,
    manifestGestureId: plan.manifestGestureId,
    manifestGestureType: plan.manifestGestureType,
    gestureResolutionSource: plan.gestureResolutionSource,
  };
}

function toPendingEventDebugSnapshot(
  event: AvatarPlannerMotionEvent,
): AvatarPlannerPendingEventDebugSnapshot {
  if (event.type === "runStarted") {
    return {
      type: event.type,
      eventId: event.eventId,
      runId: event.runId,
      createdAtMs: event.createdAtMs,
      inputTextLength: event.inputText.length,
      thinkingPoseDwellMs: event.thinkingPoseDwellMs ?? null,
    };
  }
  if (event.type === "gestureRequested") {
    return {
      type: event.type,
      eventId: event.eventId,
      requestId: event.requestId,
      runId: event.runId,
      createdAtMs: event.createdAtMs,
      animationHint: event.animationHint,
      sourceEventId: event.sourceEventId,
      sourceEmotionEventId: event.sourceEmotionEventId,
    };
  }
  return {
    type: event.type,
    eventId: event.eventId,
    emotionEventId: event.emotionEventId,
    runId: event.runId,
    animationHint: event.animationHint,
    createdAtMs: event.createdAtMs,
  };
}

function resolveActiveGestureDebugSnapshot(
  state: AvatarPlannerMotionState,
): AvatarPlannerResolvedGestureDebugSnapshot | null {
  const activeVrma = state.activeGestureVrma;
  if (activeVrma?.manifestGestureId) {
    return {
      id: activeVrma.manifestGestureId,
      type: activeVrma.manifestGestureType ?? "vrma",
      source: activeVrma.gestureResolutionSource ?? "manifest",
      requestId: activeVrma.gestureRequestId,
      clipId: activeVrma.clipName,
    };
  }

  const activePoseClip = state.activePlannerPoseClip;
  if (isGesturePoseClip(activePoseClip) && activePoseClip.manifestGestureId) {
    return {
      id: activePoseClip.manifestGestureId,
      type: activePoseClip.manifestGestureType ?? "animaPoseClip",
      source: activePoseClip.gestureResolutionSource ?? "manifest",
      requestId: activePoseClip.requestId,
      clipId: activePoseClip.clipId,
    };
  }

  return null;
}

function resolveTalkingMotionSource(args: {
  input: AvatarPlannerMotionInput;
  state: AvatarPlannerMotionState;
}): AvatarPlannerTalkingMotionSource {
  if (args.input.interactionPhase !== "talking") return "none";
  if (
    args.state.activeGestureVrma?.manifestGestureId ||
    isGesturePoseClip(args.state.activePlannerPoseClip)
  ) {
    return "manifestGesture";
  }
  if (
    args.state.proceduralStints.some(
      (stint) => stint.policy === "talking" && stint.enabled,
    )
  ) {
    return "talkingHands";
  }
  if (
    args.state.talkingMotionArbitration.status === "awaitingEmotionUpdate" ||
    args.state.pendingEvents.some((event) => event.type === "gestureRequested")
  ) {
    return "pending";
  }
  return "none";
}

export function calculateMotionClipEffectiveDuration(
  baseDurationSec: number | null,
  timeScale: number,
  loopType: AnimationLoopType,
  loopCount?: number,
): number | null {
  if (baseDurationSec === null || baseDurationSec <= 0) {
    return null;
  }

  const safeTimeScale = timeScale > 0 ? timeScale : 1;
  const scaledDuration = baseDurationSec / safeTimeScale;

  let repetitions: number;
  switch (loopType) {
    case "once":
      repetitions = 1;
      break;
    case "repeat":
      repetitions =
        typeof loopCount === "number" &&
        loopCount > 0 &&
        Number.isFinite(loopCount)
          ? loopCount
          : Number.POSITIVE_INFINITY;
      break;
    case "pingpong":
      repetitions =
        typeof loopCount === "number" &&
        loopCount > 0 &&
        Number.isFinite(loopCount)
          ? loopCount
          : 2;
      break;
    default:
      repetitions = 1;
  }

  if (!Number.isFinite(repetitions)) {
    return null;
  }
  return scaledDuration * repetitions;
}

function resolveBaseState(phase: AvatarInteractionPhase): AvatarAnimationState {
  switch (phase) {
    case "talking":
    case "responding_no_tts":
      return "talking";
    case "thinking":
    case "submitting":
      return "thinking";
    case "listening":
    case "user_speaking":
    case "semantic_check":
      return "listening";
    default:
      return "idle";
  }
}

function isAssistantPresentationPhase(phase: AvatarInteractionPhase): boolean {
  return phase === "talking" || phase === "responding_no_tts";
}

export function hasBlockingNonTtsPresentationWork(
  output: AvatarPlannerOutput | null,
  runId: string,
): boolean {
  const state = output?.state;
  if (!state || state.activeRunId !== runId) return false;
  if (state.activeGestureVrma?.manifestGestureId) return true;
  if (
    state.activePlannerPoseClip?.runId === runId &&
    state.activePlannerPoseClip.source === "gesture"
  ) {
    return true;
  }
  if (state.activeReactionClip?.runId === runId) return true;
  if (
    state.pendingEvents.some(
      (event) => event.type === "gestureRequested" && event.runId === runId,
    )
  ) {
    return true;
  }
  return state.pendingReactionClipEvents.some((event) => event.runId === runId);
}

function canStartGestureForPhase(phase: AvatarInteractionPhase): boolean {
  return phase === "idle" || isAssistantPresentationPhase(phase);
}

function planVrma(args: {
  previous: AvatarPlannerMotionState;
  input: AvatarPlannerMotionInput;
  baseState: AvatarAnimationState;
  emotionKey: string;
  emotionIntensity: number;
  pendingEvents: readonly AvatarPlannerMotionEvent[];
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
  nextRandomRoll: () => number;
  consumedPlannerEventIds: string[];
  ignoredEventReasons: string[];
}): {
  activeBaseVrma: AvatarPlannerVrma | null;
  activeGestureVrma: AvatarPlannerVrma | null;
  gesturePoseClip: AvatarPlannerPoseClip | null;
  idlePoseClip?: AvatarPlannerPoseClip;
  idleStint: AvatarPlannerIdleStintState;
  idleStintDebug: AvatarPlannerIdleStintDebugSnapshot;
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
  pendingEvents: AvatarPlannerMotionEvent[];
  actions: AvatarPlannerMotionAction[];
  lastCancellationReason: string | null;
} {
  const motionCatalog =
    args.input.motionCatalog ?? BUILT_IN_AVATAR_MOTION_CATALOG;
  const actions: AvatarPlannerMotionAction[] = [];
  const previousGesture = args.previous.activeGestureVrma;
  const previousGestureExpiresAtMs = previousGesture?.expiresAtMs ?? null;
  const gestureStillActive =
    previousGestureExpiresAtMs !== null &&
    args.input.nowMs < previousGestureExpiresAtMs;
  const poseGestureStillActive =
    isGesturePoseClip(
      args.input.activePlannerPoseClip ?? args.previous.activePlannerPoseClip,
    ) && args.input.plannerPoseClipRuntimeActive !== false;
  const gestureEventRead = readGestureEvent({
    events: args.pendingEvents,
    motionCatalog,
    activeRunId: args.input.activeRunId,
    interactionPhase: args.input.interactionPhase,
    // PoseController stays active during an exit fade. Keep the request queued
    // until that coordinated transition clears instead of consuming it early.
    canStartNow:
      !gestureStillActive &&
      !poseGestureStillActive &&
      !args.input.manualPoseClipActive,
    talkingMotionArbitration: args.talkingMotionArbitration,
    consumedPlannerEventIds: args.consumedPlannerEventIds,
    ignoredEventReasons: args.ignoredEventReasons,
  });
  const idleQuietIntervalSec = sanitizeIdleStintQuietIntervalSec(
    args.input.idleStintQuietIntervalSec,
  );

  if (previousGesture && gestureStillActive) {
    const idleStint = args.previous.idleStint;
    return {
      activeBaseVrma: args.previous.activeBaseVrma,
      activeGestureVrma: {
        ...previousGesture,
        nextEvalMs: Math.max(0, previousGestureExpiresAtMs - args.input.nowMs),
      },
      gesturePoseClip: null,
      idleStint,
      idleStintDebug: buildIdleStintDebug({
        idleStint,
        quietIntervalSec: idleQuietIntervalSec,
        nowMs: args.input.nowMs,
        selectedCandidate: findIdleStintSelectedCandidate(
          args.previous.activeBaseVrma,
          args.input.emotionalState,
          motionCatalog,
        ),
        evaluation: motionCatalog.evaluateIdleAnimations(
          args.input.emotionalState,
        ),
      }),
      talkingMotionArbitration: gestureEventRead.talkingMotionArbitration,
      pendingEvents: gestureEventRead.pendingEvents,
      actions,
      lastCancellationReason: args.previous.lastCancellationReason,
    };
  }

  const expiredGesture = Boolean(previousGesture);
  const nextGestureEvent = gestureEventRead.gestureEvent;

  if (nextGestureEvent) {
    const gesturePlan = buildGesturePlan({
      baseState: args.baseState,
      emotionKey: args.emotionKey,
      emotionIntensity: args.emotionIntensity,
      event: nextGestureEvent,
      nowMs: args.input.nowMs,
      motionCatalog,
    });
    if (
      gesturePlan?.kind === "vrma" &&
      gesturePlan.plan.clipName &&
      gesturePlan.plan.clipUrl
    ) {
      actions.push({
        type: "playVrmaGesture",
        ownerId: gesturePlan.plan.ownerId,
        lane: "gestureVrma",
        requestId: nextGestureEvent.requestId,
        plan: gesturePlan.plan,
        clipName: gesturePlan.plan.clipName,
        clipUrl: gesturePlan.plan.clipUrl,
        transition: { mode: "crossfade", durationSec: GESTURE_CROSSFADE_SEC },
      });
      const idleStint = createQuietIdleStintState({
        quietStartedAtMs: gesturePlan.plan.expiresAtMs ?? args.input.nowMs,
        quietIntervalSec: idleQuietIntervalSec,
        lastSelectedFile:
          args.previous.idleStint.lastSelectedFile ??
          args.previous.activeBaseVrma?.clip?.file ??
          null,
      });
      return {
        activeBaseVrma:
          args.baseState === "idle" ? null : args.previous.activeBaseVrma,
        activeGestureVrma: gesturePlan.plan,
        gesturePoseClip: null,
        idleStint,
        idleStintDebug: buildIdleStintDebug({
          idleStint,
          quietIntervalSec: idleQuietIntervalSec,
          nowMs: args.input.nowMs,
          selectedCandidate: null,
          evaluation: motionCatalog.evaluateIdleAnimations(
            args.input.emotionalState,
          ),
        }),
        talkingMotionArbitration: gestureEventRead.talkingMotionArbitration,
        pendingEvents: gestureEventRead.pendingEvents,
        actions,
        lastCancellationReason: null,
      };
    }
    if (gesturePlan?.kind === "poseClip") {
      const idleStint = createQuietIdleStintState({
        quietStartedAtMs: args.input.nowMs,
        quietIntervalSec: idleQuietIntervalSec,
        lastSelectedFile:
          args.previous.idleStint.lastSelectedFile ??
          args.previous.activeBaseVrma?.clip?.file ??
          null,
      });
      return {
        activeBaseVrma:
          args.baseState === "idle" ? null : args.previous.activeBaseVrma,
        activeGestureVrma: null,
        gesturePoseClip: gesturePlan.poseClip,
        idleStint,
        idleStintDebug: buildIdleStintDebug({
          idleStint,
          quietIntervalSec: idleQuietIntervalSec,
          nowMs: args.input.nowMs,
          selectedCandidate: null,
          evaluation: motionCatalog.evaluateIdleAnimations(
            args.input.emotionalState,
          ),
        }),
        talkingMotionArbitration: gestureEventRead.talkingMotionArbitration,
        pendingEvents: gestureEventRead.pendingEvents,
        actions,
        lastCancellationReason: null,
      };
    } else {
      args.ignoredEventReasons.push(
        `gestureRequested:${nextGestureEvent.requestId}:noAnimationClip`,
      );
    }
  }

  const crossFadeSec = expiredGesture
    ? GESTURE_CROSSFADE_SEC
    : DEFAULT_CROSSFADE_SEC;

  if (args.baseState === "idle") {
    const idlePlan = buildIdleStintPlan({
      previousBase: args.previous.activeBaseVrma,
      previousPoseClip:
        args.input.activePlannerPoseClip ?? args.previous.activePlannerPoseClip,
      poseClipRuntimeActive: args.input.plannerPoseClipRuntimeActive,
      blocked:
        args.input.manualPoseClipActive ||
        poseGestureStillActive ||
        args.input.idlePlaybackBlocked === true,
      previousIdleStint: args.previous.idleStint,
      emotionalState: args.input.emotionalState,
      emotionKey: args.emotionKey,
      emotionIntensity: args.emotionIntensity,
      nowMs: args.input.nowMs,
      quietIntervalSec: idleQuietIntervalSec,
      crossFadeSec,
      nextRandomRoll: args.nextRandomRoll,
      motionCatalog,
    });

    actions.push(...idlePlan.actions);
    return {
      activeBaseVrma: idlePlan.activeBaseVrma,
      activeGestureVrma: null,
      gesturePoseClip: null,
      idlePoseClip: idlePlan.idlePoseClip,
      idleStint: idlePlan.idleStint,
      idleStintDebug: idlePlan.idleStintDebug,
      talkingMotionArbitration: gestureEventRead.talkingMotionArbitration,
      pendingEvents: gestureEventRead.pendingEvents,
      actions,
      lastCancellationReason: null,
    };
  }

  const loopPlan = buildLoopPlan({
    previous: args.previous.activeBaseVrma,
    state: args.baseState,
    emotionKey: args.emotionKey,
    emotionIntensity: args.emotionIntensity,
    nowMs: args.input.nowMs,
    crossFadeSec,
    nextRandomRoll: args.nextRandomRoll,
  });

  const stopPreviousBase = !loopPlan.plan
    ? createStopVrmaLoopAction(
        args.previous.activeBaseVrma,
        "baseStateHasNoManifestLoop",
      )
    : null;
  if (stopPreviousBase) {
    actions.push(stopPreviousBase);
  }

  if (
    loopPlan.plan?.clipName &&
    loopPlan.plan.clipUrl &&
    (loopPlan.changed || expiredGesture)
  ) {
    actions.push({
      type: "playVrmaLoop",
      ownerId: loopPlan.plan.ownerId,
      lane: "baseVrma",
      plan: loopPlan.plan,
      clipName: loopPlan.plan.clipName,
      clipUrl: loopPlan.plan.clipUrl,
      transition: {
        mode: "crossfade",
        durationSec: loopPlan.plan.crossFadeSec,
      },
    });
  }

  return {
    activeBaseVrma: loopPlan.plan,
    activeGestureVrma: null,
    gesturePoseClip: null,
    idleStint: createInitialIdleStintState(),
    idleStintDebug: buildIdleStintDebug({
      idleStint: createInitialIdleStintState(),
      quietIntervalSec: idleQuietIntervalSec,
      nowMs: args.input.nowMs,
      selectedCandidate: null,
      evaluation: motionCatalog.evaluateIdleAnimations(
        args.input.emotionalState,
      ),
    }),
    talkingMotionArbitration: gestureEventRead.talkingMotionArbitration,
    pendingEvents: gestureEventRead.pendingEvents,
    actions,
    lastCancellationReason: null,
  };
}

function readGestureEvent(args: {
  events: readonly AvatarPlannerMotionEvent[];
  motionCatalog: AvatarMotionCatalog;
  activeRunId: string | null;
  interactionPhase: AvatarInteractionPhase;
  canStartNow: boolean;
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
  consumedPlannerEventIds: string[];
  ignoredEventReasons: string[];
}): {
  gestureEvent: AvatarPlannerGestureEvent | null;
  pendingEvents: AvatarPlannerMotionEvent[];
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
} {
  const pendingEvents: AvatarPlannerMotionEvent[] = [];
  let gestureEvent: AvatarPlannerGestureEvent | null = null;
  let talkingMotionArbitration = args.talkingMotionArbitration;
  const phaseCanStartGesture = canStartGestureForPhase(args.interactionPhase);

  for (const event of args.events) {
    if (event.type === "runStarted") {
      pendingEvents.push(event);
      continue;
    }

    if (event.type === "emotionUpdated") {
      args.consumedPlannerEventIds.push(event.eventId);
      const arbitrationUpdate = resolveTalkingMotionArbitrationFromEmotion({
        arbitration: talkingMotionArbitration,
        event,
        activeRunId: args.activeRunId,
      });
      talkingMotionArbitration = arbitrationUpdate.arbitration;
      args.ignoredEventReasons.push(arbitrationUpdate.reason);
      continue;
    }

    if (event.runId && event.runId !== args.activeRunId) {
      args.consumedPlannerEventIds.push(event.eventId);
      args.ignoredEventReasons.push(
        `gestureRequested:${event.requestId}:activeRunMismatch`,
      );
      continue;
    }

    // Reject before phase/arbitration queuing: availability changing later must
    // never resurrect a gesture that arrived while its bytes were pending.
    if (
      event.animationHint &&
      args.motionCatalog.isGesturePending?.(event.animationHint)
    ) {
      args.consumedPlannerEventIds.push(event.eventId);
      args.ignoredEventReasons.push(
        `gestureRequested:${event.requestId}:resourcePending`,
      );
      continue;
    }

    const gestureArbitration = resolveTalkingMotionArbitrationFromGesture({
      arbitration: talkingMotionArbitration,
      event,
      activeRunId: args.activeRunId,
    });
    talkingMotionArbitration = gestureArbitration.arbitration;
    if (gestureArbitration.blockedReason) {
      args.consumedPlannerEventIds.push(event.eventId);
      args.ignoredEventReasons.push(gestureArbitration.blockedReason);
      continue;
    }

    if (!args.canStartNow || !phaseCanStartGesture || gestureEvent) {
      pendingEvents.push(event);
      continue;
    }

    gestureEvent = event;
    args.consumedPlannerEventIds.push(event.eventId);
  }

  return { gestureEvent, pendingEvents, talkingMotionArbitration };
}

function resolveTalkingMotionArbitrationFromEmotion(args: {
  arbitration: AvatarPlannerTalkingMotionArbitration;
  event: AvatarPlannerEmotionEvent;
  activeRunId: string | null;
}): {
  arbitration: AvatarPlannerTalkingMotionArbitration;
  reason: string;
} {
  const eventKey = args.event.emotionEventId ?? args.event.eventId;
  if (
    !args.activeRunId ||
    !args.event.runId ||
    args.event.runId !== args.activeRunId
  ) {
    return {
      arbitration: args.arbitration,
      reason: `emotionUpdated:${eventKey}:activeRunMismatch`,
    };
  }

  if (args.arbitration.status !== "awaitingEmotionUpdate") {
    return {
      arbitration: args.arbitration,
      reason: `emotionUpdated:${eventKey}:talkingMotionAlreadyResolved`,
    };
  }

  const animationHint = normalizeMotionAnimationHint(args.event.animationHint);
  if (animationHint) {
    return {
      arbitration: {
        runId: args.activeRunId,
        status: "manifestAnimationRequested",
        sourceMotionEventId: args.event.eventId,
        sourceEmotionEventId: args.event.emotionEventId,
        animationHint,
      },
      reason: `emotionUpdated:${eventKey}:gestureEventProduced`,
    };
  }

  return {
    arbitration: {
      runId: args.activeRunId,
      status: "talkingHandsAllowed",
      sourceMotionEventId: args.event.eventId,
      sourceEmotionEventId: args.event.emotionEventId,
      animationHint: null,
    },
    reason: `emotionUpdated:${eventKey}:talkingHandsAllowed`,
  };
}

function resolveTalkingMotionArbitrationFromGesture(args: {
  arbitration: AvatarPlannerTalkingMotionArbitration;
  event: AvatarPlannerGestureEvent;
  activeRunId: string | null;
}): {
  arbitration: AvatarPlannerTalkingMotionArbitration;
  blockedReason: string | null;
} {
  if (
    !args.activeRunId ||
    !args.event.runId ||
    args.event.runId !== args.activeRunId
  ) {
    return {
      arbitration: args.arbitration,
      blockedReason: null,
    };
  }

  if (args.arbitration.status === "talkingHandsAllowed") {
    return {
      arbitration: args.arbitration,
      blockedReason: `gestureRequested:${args.event.requestId}:talkingMotionAlreadyAllowed`,
    };
  }

  if (args.arbitration.status === "manifestAnimationRequested") {
    return {
      arbitration: args.arbitration,
      blockedReason: gestureMatchesTalkingMotionArbitration(
        args.event,
        args.arbitration,
      )
        ? null
        : `gestureRequested:${args.event.requestId}:talkingMotionAlreadyResolved`,
    };
  }

  const animationHint = normalizeMotionAnimationHint(args.event.animationHint);
  if (args.arbitration.status === "awaitingEmotionUpdate" && animationHint) {
    return {
      arbitration: {
        runId: args.activeRunId,
        status: "manifestAnimationRequested",
        sourceMotionEventId: args.event.sourceEventId,
        sourceEmotionEventId: args.event.sourceEmotionEventId,
        animationHint,
      },
      blockedReason: null,
    };
  }

  return {
    arbitration: args.arbitration,
    blockedReason: null,
  };
}

function gestureMatchesTalkingMotionArbitration(
  event: AvatarPlannerGestureEvent,
  arbitration: AvatarPlannerTalkingMotionArbitration,
): boolean {
  if (
    event.sourceEventId &&
    arbitration.sourceMotionEventId &&
    event.sourceEventId === arbitration.sourceMotionEventId
  ) {
    return true;
  }
  if (
    event.sourceEmotionEventId &&
    arbitration.sourceEmotionEventId &&
    event.sourceEmotionEventId === arbitration.sourceEmotionEventId
  ) {
    return true;
  }
  return (
    normalizeMotionAnimationHint(event.animationHint) !== null &&
    normalizeMotionAnimationHint(event.animationHint) ===
      normalizeMotionAnimationHint(arbitration.animationHint)
  );
}

function normalizeMotionAnimationHint(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function buildGesturePlan(args: {
  baseState: AvatarAnimationState;
  emotionKey: string;
  emotionIntensity: number;
  event: AvatarPlannerGestureEvent;
  nowMs: number;
  motionCatalog: AvatarMotionCatalog;
}): AvatarPlannerResolvedGesture | null {
  const hint = args.event.animationHint?.trim() ?? "";
  if (hint) {
    const manifestGesture = args.motionCatalog.getGesture(hint);
    if (manifestGesture) {
      return buildManifestGesturePlan({
        baseState: args.baseState,
        emotionKey: args.emotionKey,
        emotionIntensity: args.emotionIntensity,
        event: args.event,
        nowMs: args.nowMs,
        gesture: manifestGesture,
        motionCatalog: args.motionCatalog,
      });
    }
  }

  return null;
}

function buildManifestGesturePlan(args: {
  baseState: AvatarAnimationState;
  emotionKey: string;
  emotionIntensity: number;
  event: AvatarPlannerGestureEvent;
  nowMs: number;
  gesture: ManifestGestureEntry;
  motionCatalog: AvatarMotionCatalog;
}): AvatarPlannerResolvedGesture | null {
  if (args.gesture.type === "animaPoseClip") {
    return {
      kind: "poseClip",
      poseClip: createGesturePoseClip({
        event: args.event,
        nowMs: args.nowMs,
        gesture: args.gesture,
        motionCatalog: args.motionCatalog,
      }),
    };
  }

  const plan = buildTimedVrmaGesturePlan({
    baseState: args.baseState,
    emotionKey: args.emotionKey,
    emotionIntensity: args.emotionIntensity,
    event: args.event,
    nowMs: args.nowMs,
    clip: args.gesture.entry,
    loopType: args.gesture.loopType,
    loopCount: args.gesture.loopCount,
    manifestGestureId: args.gesture.id,
    manifestGestureType: args.gesture.type,
    gestureResolutionSource: "manifest",
    motionCatalog: args.motionCatalog,
  });
  return plan ? { kind: "vrma", plan, requestId: args.event.requestId } : null;
}

function buildTimedVrmaGesturePlan(args: {
  baseState: AvatarAnimationState;
  emotionKey: string;
  emotionIntensity: number;
  event: AvatarPlannerGestureEvent;
  nowMs: number;
  clip: ManifestAnimation;
  loopType: AnimationLoopType;
  loopCount?: number;
  manifestGestureId: string | null;
  manifestGestureType: ManifestGestureType | null;
  gestureResolutionSource: AvatarPlannerGestureResolutionSource;
  motionCatalog: AvatarMotionCatalog;
}): AvatarPlannerVrma | null {
  const plan = buildVrmaPlan({
    ownerId: `gesture:${args.event.requestId}`,
    lane: "gestureVrma",
    state: args.baseState,
    clip: args.clip,
    loopType: args.loopType,
    loopCount: args.loopCount,
    crossFadeSec: GESTURE_CROSSFADE_SEC,
    isGesture: true,
    gestureRequestId: args.event.requestId,
    sourceMotionEventId: args.event.eventId,
    sourceEmotionEventId: args.event.sourceEmotionEventId,
    nowMs: args.nowMs,
    emotionKey: args.emotionKey,
    emotionIntensity: args.emotionIntensity,
    manifestGestureId: args.manifestGestureId,
    manifestGestureType: args.manifestGestureType,
    gestureResolutionSource: args.gestureResolutionSource,
    motionCatalog: args.motionCatalog,
  });
  if (!plan.clipName || !plan.clipUrl) return null;
  const effectiveDurationSec =
    plan.effectiveDurationSec ?? DEFAULT_GESTURE_DURATION_SEC;
  const nextEvalMs = computeTransitionMs(
    effectiveDurationSec,
    GESTURE_CROSSFADE_SEC,
  );
  return {
    ...plan,
    durationSec:
      plan.effectiveDurationSec === null
        ? DEFAULT_GESTURE_DURATION_SEC
        : plan.durationSec,
    effectiveDurationSec,
    nextEvalMs,
    expiresAtMs: args.nowMs + nextEvalMs,
  };
}

function createGesturePoseClip(args: {
  event: AvatarPlannerGestureEvent;
  nowMs: number;
  gesture: ManifestGestureEntry;
  motionCatalog: AvatarMotionCatalog;
}): AvatarPlannerPoseClip {
  const loadedClip = args.motionCatalog.getPoseClip(args.gesture.file);
  const authoredDurationSec =
    args.gesture.duration ??
    (loadedClip ? getAnimaPoseClipTimelineDuration(loadedClip) : null);
  const effectiveDurationSec = Math.max(
    DEFAULT_GESTURE_DURATION_SEC,
    authoredDurationSec && authoredDurationSec > 0
      ? authoredDurationSec / Math.max(args.gesture.timeScale, 0.01)
      : 0,
  );
  return {
    ownerId: `gesture:${args.event.requestId}:poseClip`,
    requestId: args.event.requestId,
    runId: args.event.runId ?? "",
    clipId: args.gesture.file,
    source: "gesture",
    manifestGestureId: args.gesture.id,
    manifestGestureType: args.gesture.type,
    gestureResolutionSource: "manifest",
    sourceMotionEventId: args.event.eventId,
    sourceEmotionEventId: args.event.sourceEmotionEventId,
    status: "active",
    requestedAtMs: args.event.createdAtMs,
    eligibleAtMs: args.nowMs,
    startedAtMs: args.nowMs,
    expiresAtMs: args.nowMs + effectiveDurationSec * 1000,
    priority: 20,
    enterPolicy: { mode: "fadeIn", durationSec: 0.35 },
    exitPolicy: { mode: "fadeOut", durationSec: 0.35 },
  };
}

function buildIdleStintPlan(args: {
  previousBase: AvatarPlannerVrma | null;
  previousPoseClip: AvatarPlannerPoseClip | null;
  poseClipRuntimeActive?: boolean;
  blocked: boolean;
  previousIdleStint: AvatarPlannerIdleStintState;
  emotionalState: EmotionalState;
  emotionKey: string;
  emotionIntensity: number;
  nowMs: number;
  quietIntervalSec: number;
  crossFadeSec: number;
  nextRandomRoll: () => number;
  motionCatalog: AvatarMotionCatalog;
}): {
  activeBaseVrma: AvatarPlannerVrma | null;
  idlePoseClip?: AvatarPlannerPoseClip;
  idleStint: AvatarPlannerIdleStintState;
  idleStintDebug: AvatarPlannerIdleStintDebugSnapshot;
  actions: AvatarPlannerMotionAction[];
} {
  const actions: AvatarPlannerMotionAction[] = [];
  const previousClip =
    args.previousPoseClip?.source === "idle" ? args.previousPoseClip : null;
  if (
    args.blocked ||
    (args.previousIdleStint.phase === "active" && previousClip)
  ) {
    const continuing =
      !args.blocked &&
      previousClip &&
      (previousClip.status === "pending" ||
        args.poseClipRuntimeActive !== false);
    const idleStint = continuing
      ? args.previousIdleStint
      : createQuietIdleStintState({
          quietStartedAtMs: args.nowMs,
          quietIntervalSec: args.quietIntervalSec,
          lastSelectedFile: args.previousIdleStint.lastSelectedFile,
        });
    return {
      activeBaseVrma: null,
      idleStint,
      actions,
      idleStintDebug: buildIdleStintDebug({
        idleStint,
        quietIntervalSec: args.quietIntervalSec,
        nowMs: args.nowMs,
        selectedCandidate: null,
        evaluation: args.motionCatalog.evaluateIdleAnimations(
          args.emotionalState,
        ),
      }),
    };
  }
  const previousIdlePlan =
    args.previousBase?.state === "idle" ? args.previousBase : null;

  if (args.previousIdleStint.phase === "active" && previousIdlePlan) {
    const expiresAtMs = previousIdlePlan.expiresAtMs;
    if (expiresAtMs === null || args.nowMs < expiresAtMs) {
      const activePlan = {
        ...previousIdlePlan,
        crossFadeSec: args.crossFadeSec,
        nextEvalMs:
          expiresAtMs === null ? null : Math.max(0, expiresAtMs - args.nowMs),
      };
      const idleStint = {
        ...args.previousIdleStint,
        activePlanKey: activePlan.key,
        nextDueAtMs: expiresAtMs,
      };
      const evaluation = args.motionCatalog.evaluateIdleAnimations(
        args.emotionalState,
      );
      return {
        activeBaseVrma: activePlan,
        idleStint,
        idleStintDebug: buildIdleStintDebug({
          idleStint,
          quietIntervalSec: args.quietIntervalSec,
          nowMs: args.nowMs,
          selectedCandidate: findIdleStintSelectedCandidateFromEvaluation(
            activePlan,
            evaluation,
          ),
          evaluation,
        }),
        actions,
      };
    }

    const quietStartedAtMs = expiresAtMs ?? args.nowMs;
    const idleStint = createQuietIdleStintState({
      quietStartedAtMs,
      quietIntervalSec: args.quietIntervalSec,
      lastSelectedFile:
        previousIdlePlan.clip?.file ??
        args.previousIdleStint.lastSelectedFile ??
        null,
    });
    const stopAction = createStopVrmaLoopAction(
      previousIdlePlan,
      "idleStintCompleted",
    );
    if (stopAction) {
      actions.push(stopAction);
    }
    const evaluation = args.motionCatalog.evaluateIdleAnimations(
      args.emotionalState,
    );
    return {
      activeBaseVrma: null,
      idleStint,
      idleStintDebug: buildIdleStintDebug({
        idleStint,
        quietIntervalSec: args.quietIntervalSec,
        nowMs: args.nowMs,
        selectedCandidate: findIdleStintSelectedCandidateFromEvaluation(
          previousIdlePlan,
          evaluation,
        ),
        evaluation,
      }),
      actions,
    };
  }

  const quietStartedAtMs =
    args.previousIdleStint.phase === "quiet" &&
    args.previousIdleStint.quietStartedAtMs !== null
      ? args.previousIdleStint.quietStartedAtMs
      : args.nowMs;
  const nextDueAtMs = quietStartedAtMs + args.quietIntervalSec * 1000;
  const quietStint = createQuietIdleStintState({
    quietStartedAtMs,
    quietIntervalSec: args.quietIntervalSec,
    lastSelectedFile: args.previousIdleStint.lastSelectedFile,
  });

  if (args.nowMs < nextDueAtMs) {
    const stopAction = createStopVrmaLoopAction(
      args.previousBase,
      "idleStintQuiet",
    );
    if (stopAction) {
      actions.push(stopAction);
    }
    const evaluation = args.motionCatalog.evaluateIdleAnimations(
      args.emotionalState,
    );
    return {
      activeBaseVrma: null,
      idleStint: quietStint,
      idleStintDebug: buildIdleStintDebug({
        idleStint: quietStint,
        quietIntervalSec: args.quietIntervalSec,
        nowMs: args.nowMs,
        selectedCandidate: null,
        evaluation,
      }),
      actions,
    };
  }

  const selection = args.motionCatalog.selectIdleAnimation({
    emotionalState: args.emotionalState,
    randomRoll: args.nextRandomRoll(),
    previousFile: args.previousIdleStint.lastSelectedFile,
  });
  if (!selection.selected) {
    const stopAction = createStopVrmaLoopAction(
      args.previousBase,
      "idleStintNoCandidate",
    );
    if (stopAction) {
      actions.push(stopAction);
    }
    return {
      activeBaseVrma: null,
      idleStint: quietStint,
      idleStintDebug: buildIdleStintDebug({
        idleStint: quietStint,
        quietIntervalSec: args.quietIntervalSec,
        nowMs: args.nowMs,
        selectedCandidate: null,
        evaluation: selection,
      }),
      actions,
    };
  }

  const selected = selection.selected;
  if (selected.entry.type === "animaPoseClip") {
    const ownerId = `idle:${selected.entry.id ?? selected.file}:${args.nowMs}`;
    const idlePoseClip: AvatarPlannerPoseClip = {
      ownerId,
      requestId: ownerId,
      runId: "",
      clipId: selected.file,
      source: "idle",
      manifestGestureId: selected.entry.id ?? null,
      manifestGestureType: "animaPoseClip",
      gestureResolutionSource: null,
      sourceMotionEventId: null,
      sourceEmotionEventId: null,
      status: "pending",
      requestedAtMs: args.nowMs,
      eligibleAtMs: args.nowMs,
      startedAtMs: null,
      expiresAtMs: null,
      priority: 0,
      finitePlayback: {
        timeScale: selected.timeScale,
        repetitions: selected.loopCount ?? 1,
        durationSec: selected.effectiveDurationSec,
      },
      enterPolicy: { mode: "fadeIn", durationSec: 0.35 },
      exitPolicy: { mode: "fadeOut", durationSec: 0.35 },
    };
    const idleStint: AvatarPlannerIdleStintState = {
      phase: "active",
      quietStartedAtMs: null,
      activeStartedAtMs: null,
      activePlanKey: ownerId,
      lastSelectedFile: selected.file,
      nextDueAtMs: null,
    };
    return {
      activeBaseVrma: null,
      idlePoseClip,
      idleStint,
      actions,
      idleStintDebug: buildIdleStintDebug({
        idleStint,
        quietIntervalSec: args.quietIntervalSec,
        nowMs: args.nowMs,
        selectedCandidate: selected,
        evaluation: selection,
      }),
    };
  }
  const plan = buildVrmaPlan({
    ownerId: "state:idle:stint",
    lane: "baseVrma",
    state: "idle",
    clip: selected.entry,
    loopType: selected.loopType,
    loopCount: selected.loopCount,
    crossFadeSec: args.crossFadeSec,
    isGesture: false,
    gestureRequestId: null,
    nowMs: args.nowMs,
    emotionKey: args.emotionKey,
    emotionIntensity: args.emotionIntensity,
    motionCatalog: args.motionCatalog,
  });
  const effectiveDurationSec =
    plan.effectiveDurationSec ?? selected.effectiveDurationSec;
  const activePlan = {
    ...plan,
    effectiveDurationSec,
    key: selected.entry.idle_playback ? `${plan.key}:${args.nowMs}` : plan.key,
    nextEvalMs: selected.entry.idle_playback
      ? null
      : effectiveDurationSec * 1000,
    expiresAtMs: selected.entry.idle_playback
      ? null
      : args.nowMs + effectiveDurationSec * 1000,
  };
  const idleStint: AvatarPlannerIdleStintState = {
    phase: "active",
    quietStartedAtMs: null,
    activeStartedAtMs: selected.entry.idle_playback ? null : args.nowMs,
    activePlanKey: activePlan.key,
    lastSelectedFile: selected.file,
    nextDueAtMs: activePlan.expiresAtMs,
  };

  if (activePlan.clipName && activePlan.clipUrl) {
    actions.push({
      type: "playVrmaLoop",
      ownerId: activePlan.ownerId,
      lane: "baseVrma",
      plan: activePlan,
      clipName: activePlan.clipName,
      clipUrl: activePlan.clipUrl,
      transition: {
        mode: "crossfade",
        durationSec: activePlan.crossFadeSec,
      },
    });
  }

  return {
    activeBaseVrma: activePlan,
    idleStint,
    idleStintDebug: buildIdleStintDebug({
      idleStint,
      quietIntervalSec: args.quietIntervalSec,
      nowMs: args.nowMs,
      selectedCandidate: selected,
      evaluation: selection,
    }),
    actions,
  };
}

function buildLoopPlan(args: {
  previous: AvatarPlannerVrma | null;
  state: AvatarAnimationState;
  emotionKey: string;
  emotionIntensity: number;
  nowMs: number;
  crossFadeSec: number;
  nextRandomRoll: () => number;
}): { plan: AvatarPlannerVrma | null; changed: boolean } {
  void args.nextRandomRoll;
  return {
    plan: null,
    changed: args.previous !== null,
  };
}

function buildVrmaPlan(args: {
  ownerId: string;
  lane: Extract<AvatarPlannerLane, "baseVrma" | "gestureVrma">;
  state: AvatarAnimationState;
  clip: ManifestAnimation | null;
  loopType: AnimationLoopType;
  loopCount?: number;
  crossFadeSec: number;
  isGesture: boolean;
  gestureRequestId: string | null;
  sourceMotionEventId?: string | null;
  sourceEmotionEventId?: string | null;
  nowMs: number;
  emotionKey: string;
  emotionIntensity: number;
  manifestGestureId?: string | null;
  manifestGestureType?: ManifestGestureType | null;
  gestureResolutionSource?: AvatarPlannerGestureResolutionSource | null;
  motionCatalog: AvatarMotionCatalog;
}): AvatarPlannerVrma {
  const clipName = args.clip?.name ?? null;
  const resource = args.clip?.file
    ? args.motionCatalog.resolveVrma(args.clip.file)
    : null;
  const clipUrl = resource?.url ?? null;
  const durationSec =
    typeof args.clip?.duration === "number" && args.clip.duration > 0
      ? args.clip.duration
      : null;
  const timeScale =
    typeof args.clip?.time_scale === "number" && args.clip.time_scale > 0
      ? args.clip.time_scale
      : 1;
  const effectiveDurationSec = calculateMotionClipEffectiveDuration(
    durationSec,
    timeScale,
    args.loopType,
    args.loopCount,
  );
  const key = `${args.state}:${args.isGesture ? "gesture:" : "loop:"}${
    resource?.cacheKey ?? args.clip?.file ?? clipName ?? "none"
  }`;
  return {
    ownerId: args.ownerId,
    lane: args.lane,
    key,
    contextKey: `${args.state}:${args.emotionKey}`,
    state: args.state,
    gestureRequestId: args.gestureRequestId,
    sourceMotionEventId: args.sourceMotionEventId ?? null,
    sourceEmotionEventId: args.sourceEmotionEventId ?? null,
    clip: args.clip,
    clipName,
    clipUrl,
    loopType: args.loopType,
    loopCount: args.loopCount,
    timeScale,
    crossFadeSec: args.crossFadeSec,
    isGesture: args.isGesture,
    durationSec,
    effectiveDurationSec,
    nextEvalMs: effectiveDurationSec ? effectiveDurationSec * 1000 : null,
    startedAtMs: args.nowMs,
    expiresAtMs: effectiveDurationSec
      ? args.nowMs + effectiveDurationSec * 1000
      : null,
    emotionKey: args.emotionKey,
    emotionIntensity: args.emotionIntensity,
    manifestGestureId: args.manifestGestureId ?? null,
    manifestGestureType: args.manifestGestureType ?? null,
    gestureResolutionSource: args.gestureResolutionSource ?? null,
  };
}

function isGesturePoseClip(
  poseClip: AvatarPlannerPoseClip | null | undefined,
): poseClip is AvatarPlannerPoseClip & { source: "gesture" } {
  return poseClip?.source === "gesture";
}

function planPoseClip(args: {
  previous: AvatarPlannerMotionState;
  input: AvatarPlannerMotionInput;
  pendingEvents: readonly AvatarPlannerMotionEvent[];
  gesturePoseClip: AvatarPlannerPoseClip | null;
  idlePoseClip?: AvatarPlannerPoseClip;
  interruptIdle: boolean;
  phaseEnteredAtMs: number;
  nextRandomRoll: () => number;
  consumedPlannerEventIds: string[];
  ignoredEventReasons: string[];
}): {
  activePlannerPoseClip: AvatarPlannerPoseClip | null;
  pendingEvents: AvatarPlannerMotionEvent[];
  actions: AvatarPlannerMotionAction[];
  lastCancellationReason: string | null;
} {
  const actions: AvatarPlannerMotionAction[] = [];
  const pendingEvents: AvatarPlannerMotionEvent[] = [];
  let activeClip =
    args.input.activePlannerPoseClip ?? args.previous.activePlannerPoseClip;
  let lastCancellationReason = args.previous.lastCancellationReason;

  if (activeClip?.source === "idle") {
    const interrupted =
      resolveBaseState(args.input.interactionPhase) !== "idle" ||
      args.input.manualPoseClipActive ||
      args.input.idlePlaybackBlocked === true ||
      args.interruptIdle;
    if (
      interrupted ||
      (activeClip.status === "active" &&
        args.input.plannerPoseClipRuntimeActive === false)
    ) {
      actions.push(
        ...maybeStopPoseClip(
          activeClip,
          interrupted ? "idleInterrupted" : "idleCompleted",
        ),
      );
      activeClip = null;
    } else {
      return {
        activePlannerPoseClip: activeClip,
        pendingEvents: [...args.pendingEvents],
        actions,
        lastCancellationReason,
      };
    }
  }
  if (
    args.idlePoseClip &&
    !args.input.manualPoseClipActive &&
    resolveBaseState(args.input.interactionPhase) === "idle"
  ) {
    activeClip = args.idlePoseClip;
    actions.push({
      type: "playPoseClip",
      ownerId: activeClip.ownerId,
      lane: "poseClip",
      runId: "",
      clipId: activeClip.clipId,
      poseClip: activeClip,
      transition: activeClip.enterPolicy,
    });
    return {
      activePlannerPoseClip: activeClip,
      pendingEvents: [...args.pendingEvents],
      actions,
      lastCancellationReason: null,
    };
  }

  for (const event of args.pendingEvents) {
    if (event.type !== "runStarted") {
      pendingEvents.push(event);
      continue;
    }
    args.consumedPlannerEventIds.push(event.eventId);
    if (event.runId !== args.input.activeRunId) {
      args.ignoredEventReasons.push(
        `runStarted:${event.runId}:activeRunMismatch`,
      );
      continue;
    }
    if (activeClip?.status === "active") {
      args.ignoredEventReasons.push(
        `runStarted:${event.runId}:poseClipAlreadyActive`,
      );
      continue;
    }
    if (activeClip?.status === "pending") {
      args.ignoredEventReasons.push(
        `runStarted:${event.runId}:poseClipAlreadyPending`,
      );
      continue;
    }
    const selection = selectThinkingPoseClip({
      runId: event.runId,
      inputText: event.inputText,
      nowMs: args.input.nowMs,
      random: args.nextRandomRoll,
    });
    if (!selection) {
      args.ignoredEventReasons.push(
        `runStarted:${event.runId}:noThinkingPoseSelected`,
      );
      continue;
    }
    const dwellMs =
      typeof event.thinkingPoseDwellMs === "number" &&
      Number.isFinite(event.thinkingPoseDwellMs) &&
      event.thinkingPoseDwellMs >= 0
        ? event.thinkingPoseDwellMs
        : DEFAULT_THINKING_POSE_DWELL_MS;
    activeClip = {
      ownerId: THINKING_POSE_OWNER_ID,
      requestId: selection.requestId,
      runId: event.runId,
      clipId: selection.clipId,
      source: "thinking",
      manifestGestureId: null,
      manifestGestureType: null,
      gestureResolutionSource: null,
      sourceMotionEventId: event.eventId,
      sourceEmotionEventId: null,
      status: "pending",
      requestedAtMs: selection.selectedAtMs,
      eligibleAtMs:
        Math.max(selection.selectedAtMs, args.phaseEnteredAtMs) + dwellMs,
      startedAtMs: null,
      expiresAtMs: null,
      priority: THINKING_POSE_PRIORITY,
      enterPolicy: { mode: "fadeIn", durationSec: 0.4 },
      exitPolicy: { mode: "fadeOut", durationSec: 0.35 },
    };
  }

  if (args.gesturePoseClip) {
    if (args.gesturePoseClip.runId !== args.input.activeRunId) {
      args.ignoredEventReasons.push(
        `gestureRequested:${args.gesturePoseClip.requestId}:activeRunMismatch`,
      );
    } else if (args.input.manualPoseClipActive) {
      args.ignoredEventReasons.push(
        `gestureRequested:${args.gesturePoseClip.requestId}:manualPoseClipActive`,
      );
    } else {
      if (activeClip?.status === "active") {
        actions.push(
          ...maybeStopPoseClip(activeClip, "gesturePoseClipStarted"),
        );
      }
      activeClip = args.gesturePoseClip;
      actions.push({
        type: "playPoseClip",
        ownerId: activeClip.ownerId,
        lane: "poseClip",
        runId: activeClip.runId,
        clipId: activeClip.clipId,
        poseClip: activeClip,
        transition: activeClip.enterPolicy,
      });
      return {
        activePlannerPoseClip: activeClip,
        pendingEvents,
        actions,
        lastCancellationReason: null,
      };
    }
  }

  if (!activeClip) {
    return {
      activePlannerPoseClip: null,
      pendingEvents,
      actions,
      lastCancellationReason,
    };
  }

  if (activeClip.runId !== args.input.activeRunId) {
    lastCancellationReason = "poseClipRunMismatch";
    return {
      activePlannerPoseClip: null,
      pendingEvents,
      actions: maybeStopPoseClip(activeClip, lastCancellationReason),
      lastCancellationReason,
    };
  }

  if (args.input.manualPoseClipActive) {
    lastCancellationReason = "manualPoseClipActive";
    return {
      activePlannerPoseClip: null,
      pendingEvents,
      actions: maybeStopPoseClip(activeClip, lastCancellationReason),
      lastCancellationReason,
    };
  }

  if (
    activeClip.status === "active" &&
    !isActivePoseClipPlaybackLifetimeActive(activeClip, args.input)
  ) {
    lastCancellationReason = "poseClipPlaybackLifetimeEnded";
    return {
      activePlannerPoseClip: null,
      pendingEvents,
      actions: maybeStopPoseClip(activeClip, lastCancellationReason),
      lastCancellationReason,
    };
  }

  if (
    isGesturePoseClip(activeClip) &&
    activeClip.status === "active" &&
    activeClip.expiresAtMs !== null &&
    args.input.nowMs >= activeClip.expiresAtMs
  ) {
    lastCancellationReason = "gesturePoseClipCompleted";
    return {
      activePlannerPoseClip: null,
      pendingEvents,
      actions: maybeStopPoseClip(activeClip, lastCancellationReason),
      lastCancellationReason,
    };
  }

  if (isGesturePoseClip(activeClip)) {
    if (
      activeClip.status === "active" &&
      args.input.plannerPoseClipRuntimeActive === false
    ) {
      lastCancellationReason = "poseClipCompleted";
      return {
        activePlannerPoseClip: null,
        pendingEvents,
        actions,
        lastCancellationReason,
      };
    }
    if (
      !isAssistantPresentationPhase(args.input.interactionPhase) &&
      args.input.interactionPhase !== "idle"
    ) {
      lastCancellationReason = `phaseChanged:${args.input.interactionPhase}`;
      return {
        activePlannerPoseClip: null,
        pendingEvents,
        actions: maybeStopPoseClip(activeClip, lastCancellationReason),
        lastCancellationReason,
      };
    }
    return {
      activePlannerPoseClip: activeClip,
      pendingEvents,
      actions,
      lastCancellationReason,
    };
  }

  if (args.input.interactionPhase !== "thinking") {
    lastCancellationReason = `phaseChanged:${args.input.interactionPhase}`;
    return {
      activePlannerPoseClip: null,
      pendingEvents,
      actions: maybeStopPoseClip(
        activeClip,
        lastCancellationReason,
        selectPoseClipExitPolicy(args.input.interactionPhase),
      ),
      lastCancellationReason,
    };
  }

  if (
    activeClip.status === "pending" &&
    args.input.nowMs >= activeClip.eligibleAtMs
  ) {
    const startedClip: AvatarPlannerPoseClip = {
      ...activeClip,
      status: "active",
      startedAtMs: args.input.nowMs,
    };
    actions.push({
      type: "playPoseClip",
      ownerId: startedClip.ownerId,
      lane: "poseClip",
      runId: startedClip.runId,
      clipId: startedClip.clipId,
      poseClip: startedClip,
      transition: startedClip.enterPolicy,
    });
    return {
      activePlannerPoseClip: startedClip,
      pendingEvents,
      actions,
      lastCancellationReason: null,
    };
  }

  return {
    activePlannerPoseClip: activeClip,
    pendingEvents,
    actions,
    lastCancellationReason,
  };
}

function maybeStopPoseClip(
  poseClip: AvatarPlannerPoseClip,
  reason: string,
  transition: AvatarPlannerExitPolicy = { mode: "fadeOut", durationSec: 0.35 },
): AvatarPlannerMotionAction[] {
  if (poseClip.status !== "active" && poseClip.source !== "idle") {
    return [];
  }
  return [
    {
      type: "stopPoseClip",
      ownerId: poseClip.ownerId,
      lane: "poseClip",
      clipId: poseClip.clipId,
      reason,
      transition,
    },
  ];
}

function isActivePoseClipPlaybackLifetimeActive(
  poseClip: AvatarPlannerPoseClip,
  input: AvatarPlannerMotionInput,
): boolean {
  const clip = input.motionCatalog?.getPoseClip(poseClip.clipId) ?? null;

  if (!clip?.playback) return true;
  return isAnimaPoseClipPlaybackLifetimeActive(clip.playback, {
    interactionPhase: input.interactionPhase,
    avatarState: input.avatarState,
    activeRunId: input.activeRunId,
    ownerRunId: poseClip.runId,
  });
}

function selectPoseClipExitPolicy(
  nextPhase: AvatarInteractionPhase,
): AvatarPlannerExitPolicy {
  if (isAssistantPresentationPhase(nextPhase)) {
    return { mode: "fadeOut", durationSec: 0.3 };
  }
  return { mode: "fadeOut", durationSec: 0.35 };
}

function planProcedural(args: {
  previous: AvatarPlannerMotionState;
  input: AvatarPlannerMotionInput;
  baseState: AvatarAnimationState;
  manifestGestureActive: boolean;
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration;
  nextRandomRoll: () => number;
}): {
  proceduralStints: AvatarPlannerProceduralStint[];
  actions: AvatarPlannerMotionAction[];
} {
  const actions: AvatarPlannerMotionAction[] = [];
  const desiredPolicies = getDesiredProceduralPolicies(
    args.input,
    args.baseState,
    args.manifestGestureActive,
    args.talkingMotionArbitration,
  );
  const desiredPolicySet = new Set(desiredPolicies);
  const activePlannerLayerIds = new Set(
    args.input.activePlannerProceduralLayerIds,
  );
  const retainedStints: AvatarPlannerProceduralStint[] = [];

  for (const stint of args.previous.proceduralStints) {
    if (!desiredPolicySet.has(stint.policy)) {
      if (
        stint.layerId &&
        stint.enabled &&
        activePlannerLayerIds.has(stint.layerId)
      ) {
        const action = createProceduralPolicyAction(stint, false);
        if (action) {
          actions.push(action);
        }
      }
      continue;
    }

    retainedStints.push({
      ...stint,
      enabled: Boolean(
        stint.enabled &&
        stint.layerId &&
        activePlannerLayerIds.has(stint.layerId),
      ),
    });
  }

  const retainedPolicySet = new Set(
    retainedStints.map((stint) => stint.policy),
  );
  for (const policy of desiredPolicies) {
    if (retainedPolicySet.has(policy)) {
      continue;
    }
    const stint = createProceduralStint({
      policy,
      input: args.input,
      nowMs: args.input.nowMs,
      nextRandomRoll: args.nextRandomRoll,
    });
    retainedStints.push(stint);
    if (stint.layerId && stint.enabled) {
      const action = createProceduralPolicyAction(stint, true);
      if (action) {
        actions.push(action);
      }
    }
  }

  for (const activeLayerId of activePlannerLayerIds) {
    const retainedOwner = retainedStints.find(
      (stint) => stint.layerId === activeLayerId && stint.enabled,
    );
    const alreadyDisabling = actions.some(
      (action) =>
        action.type === "setProceduralPolicy" &&
        action.layerId === activeLayerId &&
        !action.enabled,
    );
    if (!retainedOwner && !alreadyDisabling) {
      actions.push({
        type: "setProceduralPolicy",
        ownerId: `stale:procedural:${activeLayerId}`,
        lane: "procedural",
        layerId: activeLayerId,
        enabled: false,
      });
    }
  }

  return {
    proceduralStints: retainedStints,
    actions,
  };
}

function getDesiredProceduralPolicies(
  input: AvatarPlannerMotionInput,
  baseState: AvatarAnimationState,
  manifestGestureActive: boolean,
  talkingMotionArbitration: AvatarPlannerTalkingMotionArbitration,
): AvatarPlannerProceduralPolicy[] {
  const policies: AvatarPlannerProceduralPolicy[] = [];
  if (shouldUseEmotionPosturePolicy(input)) {
    policies.push("emotionPosture");
  }

  const interactionPhase = input.interactionPhase;
  if (interactionPhase === "user_typing") {
    policies.push("listening");
    return policies;
  }
  if (baseState === "listening") {
    policies.push("listening");
    return policies;
  }
  if (
    interactionPhase === "talking" &&
    baseState === "talking" &&
    !manifestGestureActive &&
    talkingMotionArbitration.status === "talkingHandsAllowed"
  ) {
    policies.push("talking");
    return policies;
  }
  return policies;
}

function createProceduralStint(args: {
  policy: AvatarPlannerProceduralPolicy;
  input: AvatarPlannerMotionInput;
  nowMs: number;
  nextRandomRoll: () => number;
}): AvatarPlannerProceduralStint {
  const layerId =
    args.policy === "emotionPosture"
      ? "emotionPosture"
      : args.policy === "listening"
        ? selectListeningProceduralLayerId(args.nextRandomRoll())
        : "talkingHands";
  const ownerId =
    args.policy === "emotionPosture"
      ? EMOTION_POSTURE_PROCEDURAL_OWNER_ID
      : args.policy === "listening"
        ? LISTENING_PROCEDURAL_OWNER_ID
        : TALKING_PROCEDURAL_OWNER_ID;

  return {
    ownerId,
    policy: args.policy,
    layerId,
    startedAtMs: args.nowMs,
    enabled:
      layerId !== null && canEnablePlannerProceduralLayer(layerId, args.input),
  };
}

function shouldUseEmotionPosturePolicy(
  input: AvatarPlannerMotionInput,
): boolean {
  const config = input.emotionPostureConfig;
  if (config?.plannerEnabled === false) return false;

  const dominantGroup = input.emotionalState.dominantGroup;
  if (dominantGroup === "neutral") return false;
  if (!isEmotionPostureGroup(dominantGroup)) return false;

  const summary = input.emotionalState.dominantGroupSummary;
  const intensity = summary?.intensity ?? 0;
  if (intensity <= 0) return false;

  if (config?.presetEnabledByGroup[dominantGroup] === false) return false;
  return canEnablePlannerProceduralLayer("emotionPosture", input);
}

function selectListeningProceduralLayerId(
  randomRoll: number,
): ProceduralAnimationLayerId | null {
  const bounceChance = sanitizeChance(LISTENING_BOUNCE_CHANCE);
  const headNodChance = Math.min(
    sanitizeChance(LISTENING_HEAD_NOD_CHANCE),
    1 - bounceChance,
  );
  const roll = sanitizeRandomRoll(randomRoll);

  if (roll < bounceChance) return "bounce";
  if (roll < bounceChance + headNodChance) return "headNod";
  return null;
}

function canEnablePlannerProceduralLayer(
  layerId: ProceduralAnimationLayerId,
  input: AvatarPlannerMotionInput,
): boolean {
  return (
    input.eligiblePlannerProceduralLayerIds.includes(layerId) &&
    !input.manualProceduralLayerIds.includes(layerId)
  );
}

function createProceduralPolicyAction(
  stint: AvatarPlannerProceduralStint,
  enabled: boolean,
): AvatarPlannerMotionAction | null {
  if (!stint.layerId) {
    return null;
  }
  return {
    type: "setProceduralPolicy",
    ownerId: stint.ownerId,
    lane: "procedural",
    layerId: stint.layerId,
    enabled,
  };
}

function createQuietIdleStintState(args: {
  quietStartedAtMs: number;
  quietIntervalSec: number;
  lastSelectedFile: string | null;
}): AvatarPlannerIdleStintState {
  return {
    phase: "quiet",
    quietStartedAtMs: args.quietStartedAtMs,
    activeStartedAtMs: null,
    activePlanKey: null,
    lastSelectedFile: args.lastSelectedFile,
    nextDueAtMs: args.quietStartedAtMs + args.quietIntervalSec * 1000,
  };
}

function createStopVrmaLoopAction(
  plan: AvatarPlannerVrma | null,
  reason: string,
): AvatarPlannerMotionAction | null {
  if (!plan?.clipName) return null;
  return {
    type: "stopVrmaLoop",
    ownerId: plan.ownerId,
    lane: "baseVrma",
    plan,
    clipName: plan.clipName,
    reason,
    transition: { mode: "fadeOut", durationSec: plan.crossFadeSec },
  };
}

function buildIdleStintDebug(args: {
  idleStint: AvatarPlannerIdleStintState;
  quietIntervalSec: number;
  nowMs: number;
  selectedCandidate: ManifestIdleCandidateDebug | null;
  evaluation: {
    candidates: ManifestIdleCandidateDebug[];
    eligibleCount: number;
  };
}): AvatarPlannerIdleStintDebugSnapshot {
  return {
    phase: args.idleStint.phase,
    quietIntervalSec: args.quietIntervalSec,
    quietStartedAtMs: args.idleStint.quietStartedAtMs,
    activeStartedAtMs: args.idleStint.activeStartedAtMs,
    nextDueAtMs: args.idleStint.nextDueAtMs,
    nextEvalMs:
      args.idleStint.nextDueAtMs === null
        ? null
        : Math.max(0, args.idleStint.nextDueAtMs - args.nowMs),
    selectedCandidate: args.selectedCandidate
      ? toIdleCandidateDebug(args.selectedCandidate)
      : null,
    eligibleCandidateCount: args.evaluation.eligibleCount,
    candidates: args.evaluation.candidates.map(toIdleCandidateDebug),
  };
}

function findIdleStintSelectedCandidate(
  plan: AvatarPlannerVrma | null,
  emotionalState: EmotionalState,
  motionCatalog: AvatarMotionCatalog,
): ManifestIdleCandidateDebug | null {
  const evaluation = motionCatalog.evaluateIdleAnimations(emotionalState);
  return findIdleStintSelectedCandidateFromEvaluation(plan, evaluation);
}

function findIdleStintSelectedCandidateFromEvaluation(
  plan: AvatarPlannerVrma | null,
  evaluation: { candidates: ManifestIdleCandidateDebug[] },
): ManifestIdleCandidateDebug | null {
  if (!plan?.clip?.file) return null;
  const planFile = plan.clip.file;
  return (
    evaluation.candidates.find((candidate) => candidate.file === planFile) ??
    null
  );
}

function toIdleCandidateDebug(
  candidate: ManifestIdleCandidateDebug,
): ManifestIdleCandidateDebug {
  return {
    key: candidate.key,
    name: candidate.name,
    file: candidate.file,
    type: candidate.type,
    disabled: candidate.disabled,
    eligible: candidate.eligible,
    neutral: candidate.neutral,
    matchedEmotion: candidate.matchedEmotion,
    matchedLevel: candidate.matchedLevel,
    weight: candidate.weight,
    exclusionReason: candidate.exclusionReason,
    loopType: candidate.loopType,
    loopCount: candidate.loopCount,
    durationSec: candidate.durationSec,
    timeScale: candidate.timeScale,
    effectiveDurationSec: candidate.effectiveDurationSec,
  };
}

function sanitizeIdleStintQuietIntervalSec(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC;
  }
  return Math.max(0, value);
}

function createRandomRollReader(randomRolls: readonly number[] | undefined): {
  next: () => number;
  consumed: () => number;
} {
  let index = 0;
  return {
    next: () => {
      const roll = randomRolls?.[index] ?? 0;
      index += 1;
      return sanitizeRandomRoll(roll);
    },
    consumed: () => index,
  };
}

function sanitizeRandomRoll(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sanitizeChance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function computeTransitionMs(
  durationSec: number,
  crossFadeSec: number,
): number {
  const safeDuration = Math.max(0, durationSec);
  const leadTime = Math.min(crossFadeSec, safeDuration * 0.5);
  const transitionSec = Math.max(
    TRANSITION_BUFFER_SEC,
    safeDuration - leadTime,
  );
  return transitionSec * 1000;
}
