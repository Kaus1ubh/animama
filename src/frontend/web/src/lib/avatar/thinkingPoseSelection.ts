import type { AvatarThinkingPoseClipId } from "./types";

export const THINKING_POSE_MIN_INPUT_LENGTH = 10;
export const THINKING_HEAD_SCRATCH_CLIP_ID =
  "thinking-head-scratch" satisfies AvatarThinkingPoseClipId;
export const THINKING_HAND_ON_CHIN_HOLD_CLIP_ID =
  "thinking-hand-on-chin-hold" satisfies AvatarThinkingPoseClipId;
export const THINKING_CHIN_REST_CLIP_ID =
  "thinking-chin-rest" satisfies AvatarThinkingPoseClipId;

/** Thinking pose clips, each equally likely once a pose is chosen. */
export const THINKING_POSE_CLIP_IDS: readonly AvatarThinkingPoseClipId[] = [
  THINKING_HEAD_SCRATCH_CLIP_ID,
  THINKING_HAND_ON_CHIN_HOLD_CLIP_ID,
  THINKING_CHIN_REST_CLIP_ID,
];

export type ThinkingPoseClipSelection = {
  requestId: string;
  runId: string;
  clipId: AvatarThinkingPoseClipId;
  selectedAtMs: number;
};

export type SelectThinkingPoseClipOptions = {
  runId: string;
  inputText: string;
  random?: () => number;
  nowMs?: number;
};

export function selectThinkingPoseClip({
  runId,
  inputText,
  random = Math.random,
  nowMs = Date.now(),
}: SelectThinkingPoseClipOptions): ThinkingPoseClipSelection | null {
  const poseChance = getThinkingPoseChance(inputText);
  if (!runId || poseChance <= 0) {
    return null;
  }

  const roll = sanitizeRandomRoll(random());
  const clipId = selectThinkingPoseClipId(roll, poseChance);
  if (!clipId) {
    return null;
  }

  return {
    requestId: `${runId}:thinking-pose:${clipId}`,
    runId,
    clipId,
    selectedAtMs: nowMs,
  };
}

/**
 * The chance that a run shows any thinking pose, rising with the prompt's
 * length: longer prompts read as harder questions.
 */
export function getThinkingPoseChance(inputText: string): number {
  const promptLength = inputText.trim().length;
  if (promptLength > 80) return 0.8;
  if (promptLength > 50) return 0.6;
  if (promptLength > 30) return 0.4;
  if (promptLength > THINKING_POSE_MIN_INPUT_LENGTH) return 0.2;
  return 0;
}

/**
 * Pick a thinking pose from one roll: a roll below `poseChance` selects a pose,
 * splitting that range evenly across `THINKING_POSE_CLIP_IDS`.
 */
export function selectThinkingPoseClipId(
  roll: number,
  poseChance: number,
): AvatarThinkingPoseClipId | null {
  const chance = sanitizePoseChance(poseChance);
  if (roll >= chance) return null;
  const index = Math.floor((roll / chance) * THINKING_POSE_CLIP_IDS.length);
  return THINKING_POSE_CLIP_IDS[index] ?? null;
}

function sanitizePoseChance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sanitizeRandomRoll(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
