import { create } from "zustand";

import type {
  Avatar,
  BounceProceduralAnimationParams,
  BreathingProceduralAnimationParams,
  CursorLookAtProceduralAnimationParams,
  EmotionPostureProceduralAnimationParams,
  HeadNodProceduralAnimationParams,
  HeadSideTiltProceduralAnimationParams,
  ProceduralAnimationLayerSnapshot,
  SpringBoneSemantic,
  SpringBoneSemanticProfileOverride,
  SpringBoneSemanticProfileSnapshot,
  SpringBonePhysicsParams,
  SwayProceduralAnimationParams,
  TalkingHandsProceduralAnimationParams,
} from "@/lib/avatar";
import {
  DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC,
  DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_SPRING_BONE_PHYSICS_PARAMS,
  DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
} from "@/lib/avatar";

export type AnimationDebugTarget = {
  animaId: string | null;
  avatar: Avatar;
  sourceUrl: string | null;
  sourceKey: string | null;
};

export type AnimationDebugBreathingDraft =
  BreathingProceduralAnimationParams & {
    weight: number;
  };

export type AnimationDebugSwayDraft = SwayProceduralAnimationParams & {
  weight: number;
};

export type AnimationDebugBounceDraft = BounceProceduralAnimationParams & {
  weight: number;
};

export type AnimationDebugHeadNodDraft = HeadNodProceduralAnimationParams & {
  weight: number;
};

export type AnimationDebugHeadSideTiltDraft =
  HeadSideTiltProceduralAnimationParams & {
    weight: number;
  };

export type AnimationDebugCursorLookAtDraft =
  CursorLookAtProceduralAnimationParams & {
    weight: number;
  };

export type AnimationDebugTalkingHandsDraft =
  TalkingHandsProceduralAnimationParams & {
    weight: number;
  };

export type AnimationDebugEmotionPostureDraft =
  EmotionPostureProceduralAnimationParams;

export type AnimationDebugSpringBoneDraft = SpringBonePhysicsParams;
export type AnimationDebugSpringBoneProfileDraft =
  SpringBoneSemanticProfileSnapshot;

const DEFAULT_BREATHING_DRAFT: AnimationDebugBreathingDraft = {
  ...DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_SWAY_DRAFT: AnimationDebugSwayDraft = {
  ...DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_BOUNCE_DRAFT: AnimationDebugBounceDraft = {
  ...DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_HEAD_NOD_DRAFT: AnimationDebugHeadNodDraft = {
  ...DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_HEAD_SIDE_TILT_DRAFT: AnimationDebugHeadSideTiltDraft = {
  ...DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_CURSOR_LOOK_AT_DRAFT: AnimationDebugCursorLookAtDraft = {
  ...DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_TALKING_HANDS_DRAFT: AnimationDebugTalkingHandsDraft = {
  ...DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
  weight: 1,
};

const DEFAULT_EMOTION_POSTURE_DRAFT: AnimationDebugEmotionPostureDraft = {
  ...DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
  presets: cloneEmotionPosturePresets(
    DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS.presets,
  ),
};

const DEFAULT_SPRING_BONE_DRAFT: AnimationDebugSpringBoneDraft = {
  ...DEFAULT_SPRING_BONE_PHYSICS_PARAMS,
};

const DEFAULT_AUTOMATIC_ANIMATION_PLAYBACK_ENABLED = true;
const DEFAULT_VRMA_ROOTED_PLAYBACK_ENABLED = true;
const DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC_DRAFT =
  DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC;

type AnimationDebugStoreState = {
  isOpen: boolean;
  target: AnimationDebugTarget | null;
  breathingDraft: AnimationDebugBreathingDraft;
  swayDraft: AnimationDebugSwayDraft;
  bounceDraft: AnimationDebugBounceDraft;
  headNodDraft: AnimationDebugHeadNodDraft;
  headSideTiltDraft: AnimationDebugHeadSideTiltDraft;
  cursorLookAtDraft: AnimationDebugCursorLookAtDraft;
  talkingHandsDraft: AnimationDebugTalkingHandsDraft;
  emotionPostureDraft: AnimationDebugEmotionPostureDraft;
  springBoneDraft: AnimationDebugSpringBoneDraft;
  springBoneProfileDrafts: AnimationDebugSpringBoneProfileDraft[];
  automaticAnimationPlaybackEnabled: boolean;
  vrmaRootedPlaybackEnabled: boolean;
  /** Whether `vowel5` lip sync shapes the mouth with ARKit mixes. */
  arkitLipSyncEnabled: boolean;
  /** Whether the target Avatar has every ARKit vowel shape. */
  arkitLipSyncAvailable: boolean;
  idleStintQuietIntervalSec: number;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  registerTarget: (target: AnimationDebugTarget) => void;
  clearTarget: (avatar?: Avatar | null) => void;
  syncFromAvatar: () => void;
  updateBreathingParams: (
    params: Partial<BreathingProceduralAnimationParams>,
  ) => void;
  updateBreathingWeight: (weight: number) => void;
  resetBreathingDefaults: () => void;
  updateSwayParams: (params: Partial<SwayProceduralAnimationParams>) => void;
  updateSwayWeight: (weight: number) => void;
  resetSwayDefaults: () => void;
  updateBounceParams: (
    params: Partial<BounceProceduralAnimationParams>,
  ) => void;
  updateBounceWeight: (weight: number) => void;
  resetBounceDefaults: () => void;
  updateHeadNodParams: (
    params: Partial<HeadNodProceduralAnimationParams>,
  ) => void;
  updateHeadNodWeight: (weight: number) => void;
  resetHeadNodDefaults: () => void;
  updateHeadSideTiltParams: (
    params: Partial<HeadSideTiltProceduralAnimationParams>,
  ) => void;
  updateHeadSideTiltWeight: (weight: number) => void;
  resetHeadSideTiltDefaults: () => void;
  updateCursorLookAtParams: (
    params: Partial<CursorLookAtProceduralAnimationParams>,
  ) => void;
  updateCursorLookAtWeight: (weight: number) => void;
  resetCursorLookAtDefaults: () => void;
  updateTalkingHandsParams: (
    params: Partial<TalkingHandsProceduralAnimationParams>,
  ) => void;
  updateTalkingHandsWeight: (weight: number) => void;
  playTalkingHandsGroup: () => void;
  replayLastTalkingHandsSpeechGroup: () => void;
  resetTalkingHandsDefaults: () => void;
  updateEmotionPostureParams: (
    params: Partial<EmotionPostureProceduralAnimationParams>,
  ) => void;
  resetEmotionPostureDefaults: () => void;
  updateSpringBoneParams: (params: Partial<SpringBonePhysicsParams>) => void;
  updateSpringBoneProfileOverride: (
    semantic: SpringBoneSemantic,
    override: SpringBoneSemanticProfileOverride,
  ) => void;
  resetSpringBoneProfileDefaults: (semantic?: SpringBoneSemantic) => void;
  resetSpringBoneDefaults: () => void;
  setAutomaticAnimationPlaybackEnabled: (enabled: boolean) => void;
  setVrmaRootedPlaybackEnabled: (enabled: boolean) => void;
  setArkitLipSyncEnabled: (enabled: boolean) => void;
  setIdleStintQuietIntervalSec: (value: number) => void;
  clearActiveOffsets: () => void;
};

export const useAnimationDebugStore = create<AnimationDebugStoreState>(
  (set, get) => ({
    isOpen: false,
    target: null,
    breathingDraft: DEFAULT_BREATHING_DRAFT,
    swayDraft: DEFAULT_SWAY_DRAFT,
    bounceDraft: DEFAULT_BOUNCE_DRAFT,
    headNodDraft: DEFAULT_HEAD_NOD_DRAFT,
    headSideTiltDraft: DEFAULT_HEAD_SIDE_TILT_DRAFT,
    cursorLookAtDraft: DEFAULT_CURSOR_LOOK_AT_DRAFT,
    talkingHandsDraft: DEFAULT_TALKING_HANDS_DRAFT,
    emotionPostureDraft: DEFAULT_EMOTION_POSTURE_DRAFT,
    springBoneDraft: DEFAULT_SPRING_BONE_DRAFT,
    springBoneProfileDrafts: [],
    automaticAnimationPlaybackEnabled:
      DEFAULT_AUTOMATIC_ANIMATION_PLAYBACK_ENABLED,
    vrmaRootedPlaybackEnabled: DEFAULT_VRMA_ROOTED_PLAYBACK_ENABLED,
    arkitLipSyncEnabled: false,
    arkitLipSyncAvailable: false,
    idleStintQuietIntervalSec: DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC_DRAFT,
    setOpen: (isOpen) => set({ isOpen }),
    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
    registerTarget: (target) => {
      // Inspect current playback; opening diagnostics must not configure it.
      set({
        target,
        breathingDraft: resolveBreathingDraft(target.avatar),
        swayDraft: resolveSwayDraft(target.avatar),
        bounceDraft: resolveBounceDraft(target.avatar),
        headNodDraft: resolveHeadNodDraft(target.avatar),
        headSideTiltDraft: resolveHeadSideTiltDraft(target.avatar),
        cursorLookAtDraft: resolveCursorLookAtDraft(target.avatar),
        talkingHandsDraft: resolveTalkingHandsDraft(target.avatar),
        emotionPostureDraft: resolveEmotionPostureDraft(target.avatar),
        springBoneDraft: resolveSpringBoneDraft(target.avatar),
        springBoneProfileDrafts: resolveSpringBoneProfileDrafts(target.avatar),
        automaticAnimationPlaybackEnabled:
          target.avatar.isAutomaticAnimationPlaybackEnabled(),
        vrmaRootedPlaybackEnabled: target.avatar.isVrmaRootedPlaybackEnabled(),
        arkitLipSyncEnabled: target.avatar.getLipSyncShaping() === "arkit",
        arkitLipSyncAvailable: target.avatar.canShapeLipSyncWithArkit(),
        idleStintQuietIntervalSec: target.avatar.getIdleStintQuietIntervalSec(),
      });
    },
    clearTarget: (avatar) =>
      set((state) => {
        if (!state.target) return state;
        if (avatar && state.target.avatar !== avatar) return state;
        return {
          isOpen: false,
          target: null,
          breathingDraft: DEFAULT_BREATHING_DRAFT,
          swayDraft: DEFAULT_SWAY_DRAFT,
          bounceDraft: DEFAULT_BOUNCE_DRAFT,
          headNodDraft: DEFAULT_HEAD_NOD_DRAFT,
          headSideTiltDraft: DEFAULT_HEAD_SIDE_TILT_DRAFT,
          cursorLookAtDraft: DEFAULT_CURSOR_LOOK_AT_DRAFT,
          talkingHandsDraft: DEFAULT_TALKING_HANDS_DRAFT,
          emotionPostureDraft: DEFAULT_EMOTION_POSTURE_DRAFT,
          springBoneDraft: DEFAULT_SPRING_BONE_DRAFT,
          springBoneProfileDrafts: [],
          automaticAnimationPlaybackEnabled:
            DEFAULT_AUTOMATIC_ANIMATION_PLAYBACK_ENABLED,
          vrmaRootedPlaybackEnabled: DEFAULT_VRMA_ROOTED_PLAYBACK_ENABLED,
          arkitLipSyncEnabled: false,
          arkitLipSyncAvailable: false,
          idleStintQuietIntervalSec:
            DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC_DRAFT,
        };
      }),
    syncFromAvatar: () => {
      const target = get().target;
      set({
        breathingDraft: target
          ? resolveBreathingDraft(target.avatar)
          : DEFAULT_BREATHING_DRAFT,
        swayDraft: target
          ? resolveSwayDraft(target.avatar)
          : DEFAULT_SWAY_DRAFT,
        bounceDraft: target
          ? resolveBounceDraft(target.avatar)
          : DEFAULT_BOUNCE_DRAFT,
        headNodDraft: target
          ? resolveHeadNodDraft(target.avatar)
          : DEFAULT_HEAD_NOD_DRAFT,
        headSideTiltDraft: target
          ? resolveHeadSideTiltDraft(target.avatar)
          : DEFAULT_HEAD_SIDE_TILT_DRAFT,
        cursorLookAtDraft: target
          ? resolveCursorLookAtDraft(target.avatar)
          : DEFAULT_CURSOR_LOOK_AT_DRAFT,
        talkingHandsDraft: target
          ? resolveTalkingHandsDraft(target.avatar)
          : DEFAULT_TALKING_HANDS_DRAFT,
        emotionPostureDraft: target
          ? resolveEmotionPostureDraft(target.avatar)
          : DEFAULT_EMOTION_POSTURE_DRAFT,
        springBoneDraft: target
          ? resolveSpringBoneDraft(target.avatar)
          : DEFAULT_SPRING_BONE_DRAFT,
        springBoneProfileDrafts: target
          ? resolveSpringBoneProfileDrafts(target.avatar)
          : [],
        automaticAnimationPlaybackEnabled:
          target?.avatar.isAutomaticAnimationPlaybackEnabled() ??
          DEFAULT_AUTOMATIC_ANIMATION_PLAYBACK_ENABLED,
        vrmaRootedPlaybackEnabled:
          target?.avatar.isVrmaRootedPlaybackEnabled() ??
          DEFAULT_VRMA_ROOTED_PLAYBACK_ENABLED,
        arkitLipSyncEnabled: target?.avatar.getLipSyncShaping() === "arkit",
        arkitLipSyncAvailable:
          target?.avatar.canShapeLipSyncWithArkit() ?? false,
        idleStintQuietIntervalSec:
          target?.avatar.getIdleStintQuietIntervalSec() ??
          DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC_DRAFT,
      });
    },
    updateBreathingParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "breathing",
          params,
        );
        return {
          breathingDraft: {
            ...state.breathingDraft,
            ...params,
          },
        };
      }),
    updateBreathingWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight(
          "breathing",
          weight,
        );
        return {
          breathingDraft: {
            ...state.breathingDraft,
            weight,
          },
        };
      }),
    resetBreathingDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("breathing");
      set({
        breathingDraft: target
          ? resolveBreathingDraft(target.avatar)
          : DEFAULT_BREATHING_DRAFT,
      });
    },
    updateSwayParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams("sway", params);
        return {
          swayDraft: {
            ...state.swayDraft,
            ...params,
          },
        };
      }),
    updateSwayWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight("sway", weight);
        return {
          swayDraft: {
            ...state.swayDraft,
            weight,
          },
        };
      }),
    resetSwayDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("sway");
      set({
        swayDraft: target
          ? resolveSwayDraft(target.avatar)
          : DEFAULT_SWAY_DRAFT,
      });
    },
    updateBounceParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "bounce",
          params,
        );
        return {
          bounceDraft: {
            ...state.bounceDraft,
            ...params,
          },
        };
      }),
    updateBounceWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight(
          "bounce",
          weight,
        );
        return {
          bounceDraft: {
            ...state.bounceDraft,
            weight,
          },
        };
      }),
    resetBounceDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("bounce");
      set({
        bounceDraft: target
          ? resolveBounceDraft(target.avatar)
          : DEFAULT_BOUNCE_DRAFT,
      });
    },
    updateHeadNodParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "headNod",
          params,
        );
        return {
          headNodDraft: {
            ...state.headNodDraft,
            ...params,
          },
        };
      }),
    updateHeadNodWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight(
          "headNod",
          weight,
        );
        return {
          headNodDraft: {
            ...state.headNodDraft,
            weight,
          },
        };
      }),
    resetHeadNodDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("headNod");
      set({
        headNodDraft: target
          ? resolveHeadNodDraft(target.avatar)
          : DEFAULT_HEAD_NOD_DRAFT,
      });
    },
    updateHeadSideTiltParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "headSideTilt",
          params,
        );
        return {
          headSideTiltDraft: {
            ...state.headSideTiltDraft,
            ...params,
          },
        };
      }),
    updateHeadSideTiltWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight(
          "headSideTilt",
          weight,
        );
        return {
          headSideTiltDraft: {
            ...state.headSideTiltDraft,
            weight,
          },
        };
      }),
    resetHeadSideTiltDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("headSideTilt");
      set({
        headSideTiltDraft: target
          ? resolveHeadSideTiltDraft(target.avatar)
          : DEFAULT_HEAD_SIDE_TILT_DRAFT,
      });
    },
    updateCursorLookAtParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "cursorLookAt",
          params,
        );
        return {
          cursorLookAtDraft: {
            ...state.cursorLookAtDraft,
            ...params,
          },
        };
      }),
    updateCursorLookAtWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight(
          "cursorLookAt",
          weight,
        );
        return {
          cursorLookAtDraft: {
            ...state.cursorLookAtDraft,
            weight,
          },
        };
      }),
    resetCursorLookAtDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("cursorLookAt");
      set({
        cursorLookAtDraft: target
          ? resolveCursorLookAtDraft(target.avatar)
          : DEFAULT_CURSOR_LOOK_AT_DRAFT,
      });
    },
    updateTalkingHandsParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "talkingHands",
          params,
        );
        return {
          talkingHandsDraft: {
            ...state.talkingHandsDraft,
            ...params,
          },
        };
      }),
    updateTalkingHandsWeight: (weight) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerWeight(
          "talkingHands",
          weight,
        );
        return {
          talkingHandsDraft: {
            ...state.talkingHandsDraft,
            weight,
          },
        };
      }),
    playTalkingHandsGroup: () => {
      const state = get();
      state.target?.avatar.playTalkingHandsGroup({
        source: "debug",
        durationSec: state.talkingHandsDraft.gestureDurationSec,
      });
    },
    replayLastTalkingHandsSpeechGroup: () => {
      const target = get().target;
      const replayRequest = target?.avatar
        .getProceduralAnimationSnapshot()
        ?.layers.find(isTalkingHandsLayer)?.speechPlan?.replayRequest;
      if (!replayRequest) return;
      target?.avatar.playTalkingHandsGroup(replayRequest);
    },
    resetTalkingHandsDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("talkingHands");
      set({
        talkingHandsDraft: target
          ? resolveTalkingHandsDraft(target.avatar)
          : DEFAULT_TALKING_HANDS_DRAFT,
      });
    },
    updateEmotionPostureParams: (params) =>
      set((state) => {
        state.target?.avatar.setProceduralAnimationLayerParams(
          "emotionPosture",
          params,
        );
        return {
          emotionPostureDraft: mergeEmotionPostureDraft(
            state.emotionPostureDraft,
            params,
          ),
        };
      }),
    resetEmotionPostureDefaults: () => {
      const target = get().target;
      target?.avatar.resetProceduralAnimationLayer("emotionPosture");
      set({
        emotionPostureDraft: target
          ? resolveEmotionPostureDraft(target.avatar)
          : DEFAULT_EMOTION_POSTURE_DRAFT,
      });
    },
    updateSpringBoneParams: (params) =>
      set((state) => {
        state.target?.avatar.setSpringBonePhysicsParams(params);
        return {
          springBoneDraft: {
            ...state.springBoneDraft,
            ...params,
          },
          springBoneProfileDrafts: state.target
            ? resolveSpringBoneProfileDrafts(state.target.avatar)
            : [],
        };
      }),
    updateSpringBoneProfileOverride: (semantic, override) =>
      set((state) => {
        state.target?.avatar.setSpringBoneSemanticProfileOverride(
          semantic,
          override,
        );
        return {
          springBoneProfileDrafts: state.target
            ? resolveSpringBoneProfileDrafts(state.target.avatar)
            : [],
        };
      }),
    resetSpringBoneProfileDefaults: (semantic) =>
      set((state) => {
        state.target?.avatar.resetSpringBoneSemanticProfileOverrides(semantic);
        return {
          springBoneProfileDrafts: state.target
            ? resolveSpringBoneProfileDrafts(state.target.avatar)
            : [],
        };
      }),
    resetSpringBoneDefaults: () => {
      const target = get().target;
      target?.avatar.resetSpringBonePhysics();
      set({
        springBoneDraft: target
          ? resolveSpringBoneDraft(target.avatar)
          : DEFAULT_SPRING_BONE_DRAFT,
        springBoneProfileDrafts: target
          ? resolveSpringBoneProfileDrafts(target.avatar)
          : [],
      });
    },
    setAutomaticAnimationPlaybackEnabled: (enabled) =>
      set((state) => {
        state.target?.avatar.setAutomaticAnimationPlaybackEnabled(enabled);
        return {
          automaticAnimationPlaybackEnabled:
            state.target?.avatar.isAutomaticAnimationPlaybackEnabled() ??
            enabled,
        };
      }),
    setVrmaRootedPlaybackEnabled: (enabled) =>
      set((state) => {
        state.target?.avatar.setVrmaRootedPlaybackEnabled(enabled);
        return {
          vrmaRootedPlaybackEnabled:
            state.target?.avatar.isVrmaRootedPlaybackEnabled() ?? enabled,
        };
      }),
    setArkitLipSyncEnabled: (enabled) =>
      set((state) => {
        const shaping = state.target?.avatar.setLipSyncShaping(
          enabled ? "arkit" : "visemes",
        );
        return { arkitLipSyncEnabled: shaping === "arkit" };
      }),
    setIdleStintQuietIntervalSec: (value) =>
      set((state) => {
        state.target?.avatar.setIdleStintQuietIntervalSec(value);
        return {
          idleStintQuietIntervalSec:
            state.target?.avatar.getIdleStintQuietIntervalSec() ??
            Math.max(0, value),
        };
      }),
    clearActiveOffsets: () => {
      get().target?.avatar.clearProceduralAnimationOffsets();
    },
  }),
);

function resolveBreathingDraft(avatar: Avatar): AnimationDebugBreathingDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isBreathingLayer);
  if (!layer) return DEFAULT_BREATHING_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isBreathingLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"breathing"> {
  return layer.id === "breathing";
}

function resolveSwayDraft(avatar: Avatar): AnimationDebugSwayDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isSwayLayer);
  if (!layer) return DEFAULT_SWAY_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isSwayLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"sway"> {
  return layer.id === "sway";
}

function resolveBounceDraft(avatar: Avatar): AnimationDebugBounceDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isBounceLayer);
  if (!layer) return DEFAULT_BOUNCE_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isBounceLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"bounce"> {
  return layer.id === "bounce";
}

function resolveHeadNodDraft(avatar: Avatar): AnimationDebugHeadNodDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isHeadNodLayer);
  if (!layer) return DEFAULT_HEAD_NOD_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isHeadNodLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"headNod"> {
  return layer.id === "headNod";
}

function resolveHeadSideTiltDraft(
  avatar: Avatar,
): AnimationDebugHeadSideTiltDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isHeadSideTiltLayer);
  if (!layer) return DEFAULT_HEAD_SIDE_TILT_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isHeadSideTiltLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"headSideTilt"> {
  return layer.id === "headSideTilt";
}

function resolveCursorLookAtDraft(
  avatar: Avatar,
): AnimationDebugCursorLookAtDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isCursorLookAtLayer);
  if (!layer) return DEFAULT_CURSOR_LOOK_AT_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isCursorLookAtLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"cursorLookAt"> {
  return layer.id === "cursorLookAt";
}

function resolveTalkingHandsDraft(
  avatar: Avatar,
): AnimationDebugTalkingHandsDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isTalkingHandsLayer);
  if (!layer) return DEFAULT_TALKING_HANDS_DRAFT;
  return {
    ...layer.params,
    weight: layer.weight,
  };
}

function isTalkingHandsLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"talkingHands"> {
  return layer.id === "talkingHands";
}

function resolveEmotionPostureDraft(
  avatar: Avatar,
): AnimationDebugEmotionPostureDraft {
  const layer = avatar
    .getProceduralAnimationSnapshot()
    ?.layers.find(isEmotionPostureLayer);
  if (!layer) return DEFAULT_EMOTION_POSTURE_DRAFT;
  return {
    ...layer.params,
    presets: cloneEmotionPosturePresets(layer.params.presets),
  };
}

function isEmotionPostureLayer(
  layer: ProceduralAnimationLayerSnapshot,
): layer is ProceduralAnimationLayerSnapshot<"emotionPosture"> {
  return layer.id === "emotionPosture";
}

function mergeEmotionPostureDraft(
  draft: AnimationDebugEmotionPostureDraft,
  params: Partial<EmotionPostureProceduralAnimationParams>,
): AnimationDebugEmotionPostureDraft {
  return {
    ...draft,
    ...params,
    presets: params.presets
      ? {
          ...cloneEmotionPosturePresets(draft.presets),
          ...cloneEmotionPosturePresets(params.presets),
        }
      : cloneEmotionPosturePresets(draft.presets),
  };
}

function cloneEmotionPosturePresets<
  TPresets extends Partial<EmotionPostureProceduralAnimationParams["presets"]>,
>(presets: TPresets): TPresets {
  return Object.fromEntries(
    Object.entries(presets).map(([group, preset]) => [
      group,
      preset
        ? {
            ...preset,
            intensityByLevel: preset.intensityByLevel
              ? { ...preset.intensityByLevel }
              : preset.intensityByLevel,
            target: preset.target ? { ...preset.target } : preset.target,
          }
        : preset,
    ]),
  ) as TPresets;
}

function resolveSpringBoneDraft(avatar: Avatar): AnimationDebugSpringBoneDraft {
  return (
    avatar.getSpringBonePhysicsSnapshot()?.params ?? DEFAULT_SPRING_BONE_DRAFT
  );
}

function resolveSpringBoneProfileDrafts(
  avatar: Avatar,
): AnimationDebugSpringBoneProfileDraft[] {
  return avatar.getSpringBonePhysicsSnapshot()?.semanticProfiles ?? [];
}
