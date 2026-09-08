import type { AvatarThinkingPoseClipId } from "./types";

export const THINKING_POSE_MIN_INPUT_LENGTH = 10;
export const THINKING_HEAD_SCRATCH_CLIP_ID =
  "thinking-head-scratch" satisfies AvatarThinkingPoseClipId;
export const THINKING_HAND_ON_CHIN_HOLD_CLIP_ID =
  "thinking-hand-on-chin-hold" satisfies AvatarThinkingPoseClipId;

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
  const clipChance = getThinkingPoseClipChance(inputText);
  if (!runId || clipChance <= 0) {
    return null;
  }

  const roll = sanitizeRandomRoll(random());
  const clipId = selectThinkingPoseClipId(roll, clipChance);
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

export function getThinkingPoseClipChance(inputText: string): number {
  const promptLength = inputText.trim().length;
  if (promptLength > 80) return 0.4;
  if (promptLength > 50) return 0.3;
  if (promptLength > 30) return 0.2;
  if (promptLength > THINKING_POSE_MIN_INPUT_LENGTH) return 0.1;
  return 0;
}

export function selectThinkingPoseClipId(
  roll: number,
  clipChance: number,
): AvatarThinkingPoseClipId | null {
  const chance = sanitizeClipChance(clipChance);
  if (roll < chance) {
    return THINKING_HEAD_SCRATCH_CLIP_ID;
  }
  if (roll < chance * 2) {
    return THINKING_HAND_ON_CHIN_HOLD_CLIP_ID;
  }
  return null;
}

function sanitizeClipChance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.5, Math.max(0, value));
}

function sanitizeRandomRoll(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}
