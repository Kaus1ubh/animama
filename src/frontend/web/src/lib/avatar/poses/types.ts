import type { VRMHumanBoneName } from "@pixiv/three-vrm";

import type { AnimaPoseClipEventKindCounts } from "./animaPoseClip";

export type AvatarPoseBoneSnapshot = {
  resolvedBones: VRMHumanBoneName[];
  missingBones: VRMHumanBoneName[];
  resolvedExpressions: string[];
  missingExpressions: string[];
};

export type AvatarPoseSnapshot<TParams> = AvatarPoseBoneSnapshot & {
  ready: boolean;
  enabled: boolean;
  applied: boolean;
  params: TParams;
};

export type AvatarPoseClipSnapshot = AvatarPoseBoneSnapshot & {
  ready: boolean;
  applied: boolean;
  playing: boolean;
  clipId: string | null;
  elapsedSec: number;
  durationSec: number;
  loop: boolean;
  missingPoseRefs: string[];
  eventCount: number;
  eventKindCounts: AnimaPoseClipEventKindCounts;
  firedEventCount: number;
  firedEventIds: string[];
  activeEventCount: number;
  eventDispatchAvailable: boolean;
  skippedEventCount: number;
  eventErrorCount: number;
  lastEventError: string | null;
};
