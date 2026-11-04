import { create } from "zustand";

import type {
  AnimationBlendMode,
  AnimationLoopType,
  AvatarAnimationState,
} from "@/lib/avatar";

export type AnimaAnimationActionDebug = {
  name: string;
  isCurrent: boolean;
  loopType: AnimationLoopType;
  weight: number;
  blendMode: AnimationBlendMode;
  timeScale: number;
  additiveReference: string | null;
  clipDurationSec: number;
  playheadSec: number;
  effectiveDurationSec: number;
};

export type AnimaAnimationPlanDebug = {
  key: string;
  state: AvatarAnimationState;
  gestureRequestId: string | null;
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
};

export type AnimaAnimationDebugSnapshot = {
  animaId: string | null;
  updatedAtMs: number;
  avatarState: AvatarAnimationState | null;
  plan: AnimaAnimationPlanDebug | null;
  currentAction: AnimaAnimationActionDebug | null;
  activeActions: AnimaAnimationActionDebug[];
};

type AnimaAnimationDebugStoreState = {
  isOpen: boolean;
  animationSnapshotDemand: boolean;
  previousSnapshot: AnimaAnimationDebugSnapshot | null;
  snapshot: AnimaAnimationDebugSnapshot | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setAnimationSnapshotDemand: (demand: boolean) => void;
  setSnapshot: (snapshot: AnimaAnimationDebugSnapshot | null) => void;
  clearSnapshot: () => void;
};

export const useAnimaAnimationDebugStore =
  create<AnimaAnimationDebugStoreState>((set) => ({
    isOpen: false,
    animationSnapshotDemand: false,
    previousSnapshot: null,
    snapshot: null,
    setOpen: (isOpen) =>
      set((state) => ({
        isOpen,
        animationSnapshotDemand: isOpen ? state.animationSnapshotDemand : false,
      })),
    toggleOpen: () =>
      set((state) => {
        const isOpen = !state.isOpen;
        return {
          isOpen,
          animationSnapshotDemand: isOpen
            ? state.animationSnapshotDemand
            : false,
        };
      }),
    setAnimationSnapshotDemand: (animationSnapshotDemand) =>
      set({ animationSnapshotDemand }),
    setSnapshot: (snapshot) =>
      set((state) => ({
        previousSnapshot: state.snapshot,
        snapshot,
      })),
    clearSnapshot: () => set({ previousSnapshot: null, snapshot: null }),
  }));
