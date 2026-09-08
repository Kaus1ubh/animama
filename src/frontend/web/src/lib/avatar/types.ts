import type { VRMExpressionPresetName } from "@pixiv/three-vrm";
import type {
  EmotionGroup,
  EmotionRuntimeState,
  RankedEmotion,
  ResolvedEmotionGroup,
} from "@/lib/emotion";
import type { AvatarInteractionPhase } from "@/lib/types/voice-types";

// ─────────────────────────────────────────────────────────────────────────────
// Avatar Load / Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface AvatarLoadSpec {
  /** Immediate loader target, which may be a short-lived signed URL. */
  filePath: string;
  /** Stable logical source retained after loading instead of an expiring target. */
  sourceUrl?: string | null;
  sourceKey?: string | null;
  /** Verified model dependencies. Supplying this map forbids unissued network fetches. */
  resourceUrls?: Readonly<Record<string, string>>;
}

export type AvatarLoadPhase = "setup" | "vrm" | "animation";

export interface AvatarLoadProgress {
  phase: AvatarLoadPhase;
  ratio?: number;
  loaded?: number;
  total?: number;
  message?: string;
}

export type AvatarProgressCallback = (progress: AvatarLoadProgress) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Animation
// ─────────────────────────────────────────────────────────────────────────────

export type AnimationLoopType = "repeat" | "pingpong" | "once";
export type AnimationBlendMode = "normal" | "additive";

export interface AnimationOptions {
  /** Recheck the active planner/run after asynchronous decoding, immediately before play. */
  isCurrent?: () => boolean;
  fadeDuration?: number;
  warp?: boolean;
  loopType?: AnimationLoopType;
  loopCount?: number;
  timeScale?: number;
  weight?: number;
  keepExisting?: boolean;
  blendMode?: AnimationBlendMode;
  additiveReference?: string | null;
  onFinished?: () => void;
}

export interface ActiveAnimationInfo {
  name: string;
  isCurrent: boolean;
  loopType: AnimationLoopType;
  weight: number;
  blendMode: AnimationBlendMode;
  timeScale: number;
  additiveReference: string | null;
  clipDurationSec: number;
  playheadSec: number;
  durationSec: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lip-Sync Timeline
// ─────────────────────────────────────────────────────────────────────────────

export type LipSyncFrameFormat = "arkit_52" | "vowel5";

export interface SegmentMeta {
  run_id?: string | null;
  segment_id: string;
  job_id?: string | null;
  duration_seconds?: number | null;
  format?: LipSyncFrameFormat | null;
}

export interface FramePayload {
  run_id?: string | null;
  segment_id?: string | null;
  job_id?: string | null;
  frame_index?: number;
  time_sec?: number;
  values?: unknown;
  format?: LipSyncFrameFormat | null;
}

export interface InternalFrame {
  timeSec: number;
  values: number[];
  format: LipSyncFrameFormat;
}

export interface SegmentTimeline {
  id: string;
  runId: string | null;
  prevSegmentId: string | null;
  arrivalSec: number | null;
  audioStartSec: number | null;
  durationSec: number | null;
  format: LipSyncFrameFormat;
  frames: InternalFrame[];
  status: "pending" | "playing" | "completed";
  cursorIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expressions
// ─────────────────────────────────────────────────────────────────────────────

export type ActiveEmotion = RankedEmotion;
export type EmotionalState = EmotionRuntimeState;
export type EmotionLabel = ResolvedEmotionGroup;
export type EmotionGroupLabel = EmotionGroup;

export type { VRMExpressionPresetName };

// ARKit blendshape name type (for documentation)
export type ARKitBlendshapeName = string;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const BLINK_CLOSE_MAX = 0.2;
export const BLINK_OPEN_MAX = 5;

export const TRANSITION_BLEND_WINDOW_SEC = 0.12;
export const IDLE_DECAY_WINDOW_SEC = 0.7;
export const EPS = 0.01;

// ─────────────────────────────────────────────────────────────────────────────
// Animation State Machine
// ─────────────────────────────────────────────────────────────────────────────

export type AvatarAnimationState =
  | "idle"
  | "listening"
  | "thinking"
  | "gesture"
  | "talking";

export type AvatarThinkingPoseClipId =
  | "thinking-head-scratch"
  | "thinking-hand-on-chin-hold";

export type AvatarAnimationSignals = {
  interactionPhase: AvatarInteractionPhase;
};

export type AvatarStateSnapshot = {
  emotionalState: EmotionalState;
  signals: AvatarAnimationSignals;
};
