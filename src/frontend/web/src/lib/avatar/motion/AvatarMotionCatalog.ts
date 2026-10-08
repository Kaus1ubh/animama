import type { EmotionRuntimeState } from "@/lib/emotion";
import type { VRMAnimation } from "@pixiv/three-vrm-animation";
import type { RuntimeContentUrlLease } from "@/lib/runtime-content/runtimeContentDelivery";
import {
  evaluateManifestIdleEntries,
  getAllAnimations,
  getManifestGestureById,
  getManifestGestureEntries,
  getManifestIdleEntries,
  normalizeFile,
  resolveAnimationUrl,
  selectManifestIdleCandidateFromEntries,
  type ManifestAnimation,
  type ManifestGestureEntry,
  type ManifestIdleCandidateEvaluation,
  type ManifestIdleSelectionResult,
} from "../animationManifest";
import {
  AVATAR_POSE_IDS,
  AVATAR_POSE_CLIP_IDS,
  AVATAR_REACTION_CLIP_IDS,
  DEFAULT_AVATAR_POSE_IDS,
  getAvatarPose,
  getAvatarPoseClip,
  getAvatarReactionClip,
  getResolvedAvatarPose,
} from "../poses/catalog";
import type { AnimaPose, ResolvedAnimaPose } from "../poses/animaPose";
import type { AnimaPoseClipV2 } from "../poses/animaPoseClip";
import {
  getEmotionReactionClipId,
  type NormalizedEmotionReactionIntensity,
} from "../reactionClips";

export type AvatarMotionPreloadTier = "tier_a" | "tier_b" | "none";

export type AvatarVrmaResource = {
  runtimeId: string;
  url: string;
  /** Stable content identity; never an expiring object-storage target. */
  cacheKey: string;
  /** Private runtime decodes are owned by the catalog, not the global App cache. */
  cache?: Map<string, Promise<VRMAnimation | null>>;
  resourceUrls?: Readonly<Record<string, string>>;
  /** Acquire a decoder URL; the loader must release it after consumption. */
  getDownloadUrl?: () => Promise<RuntimeContentUrlLease>;
};

export type AvatarMotionPreloadEntry = {
  runtimeId: string;
  clipName: string;
  file: string;
  tier: AvatarMotionPreloadTier;
};

export type AvatarMotionClipDescriptor = {
  runtimeId: string;
  displayName: string;
  description: string | null;
  loaded: boolean;
};

/** Runtime boundary used by planner, VRMA, pose, and reaction consumers. */
export interface AvatarMotionCatalog {
  readonly revision: string;

  getIdleAnimations(): readonly ManifestAnimation[];
  evaluateIdleAnimations(
    emotionalState: EmotionRuntimeState,
  ): ManifestIdleCandidateEvaluation;
  selectIdleAnimation(args: {
    emotionalState: EmotionRuntimeState;
    randomRoll: number;
    previousFile?: string | null;
  }): ManifestIdleSelectionResult;
  getGesture(runtimeId: string | null | undefined): ManifestGestureEntry | null;
  /** A preparation wait must not turn an event into a delayed gesture queue. */
  isGesturePending?(runtimeId: string): boolean;
  listAnimations(): readonly ManifestAnimation[];

  getPoseClip(runtimeId: string): AnimaPoseClipV2 | null;
  loadPoseClip(runtimeId: string): Promise<AnimaPoseClipV2 | null>;
  listPoseClips(): readonly AvatarMotionClipDescriptor[];

  getReactionClip(runtimeId: string): AnimaPoseClipV2 | null;
  loadReactionClip(runtimeId: string): Promise<AnimaPoseClipV2 | null>;
  listReactionClips(): readonly AvatarMotionClipDescriptor[];
  getReactionRuntimeId(args: {
    emotionalTone: string | null | undefined;
    emotionalIntensity: NormalizedEmotionReactionIntensity;
  }): string | null;

  getPoseIds(): readonly string[];
  getDefaultPoseIds(): readonly string[];
  getPose(poseId: string): AnimaPose;
  getResolvedPose(poseId: string): ResolvedAnimaPose;

  getPreloadEntries(): readonly AvatarMotionPreloadEntry[];
  resolveVrma(file: string): AvatarVrmaResource | null;
  dispose(): void;
}

class BuiltInAvatarMotionCatalog implements AvatarMotionCatalog {
  readonly revision = "app-motion-catalog:v1";
  private readonly idleAnimations = getManifestIdleEntries();
  private readonly gestures = getManifestGestureEntries();
  private readonly gestureIndex = new Map(
    this.gestures.map((entry) => [entry.id, entry]),
  );
  private readonly preloadEntries = getAllAnimations()
    .filter((entry) => entry.type === "vrma" && !entry.disabled)
    .map((entry) => ({
      runtimeId: normalizeFile(entry.file) || entry.id || entry.name,
      clipName: entry.name,
      file: entry.file,
      tier:
        entry.animation_type === "idle"
          ? ("tier_a" as const)
          : ("tier_b" as const),
    }));

  getIdleAnimations(): readonly ManifestAnimation[] {
    return this.idleAnimations;
  }

  evaluateIdleAnimations(
    emotionalState: EmotionRuntimeState,
  ): ManifestIdleCandidateEvaluation {
    return evaluateManifestIdleEntries(this.idleAnimations, emotionalState);
  }

  selectIdleAnimation(args: {
    emotionalState: EmotionRuntimeState;
    randomRoll: number;
    previousFile?: string | null;
  }): ManifestIdleSelectionResult {
    return selectManifestIdleCandidateFromEntries({
      entries: this.idleAnimations,
      ...args,
    });
  }

  getGesture(
    runtimeId: string | null | undefined,
  ): ManifestGestureEntry | null {
    if (!runtimeId) return null;
    return (
      this.gestureIndex.get(normalizeFile(runtimeId)) ??
      getManifestGestureById(runtimeId)
    );
  }

  listAnimations(): readonly ManifestAnimation[] {
    return getAllAnimations();
  }

  getPoseClip(runtimeId: string): AnimaPoseClipV2 | null {
    try {
      return getAvatarPoseClip(runtimeId);
    } catch {
      return null;
    }
  }

  async loadPoseClip(runtimeId: string): Promise<AnimaPoseClipV2 | null> {
    return this.getPoseClip(runtimeId);
  }

  listPoseClips(): readonly AvatarMotionClipDescriptor[] {
    return AVATAR_POSE_CLIP_IDS.map((runtimeId) => {
      const clip = getAvatarPoseClip(runtimeId);
      return {
        runtimeId,
        displayName: clip.name,
        description: null,
        loaded: true,
      };
    });
  }

  getReactionClip(runtimeId: string): AnimaPoseClipV2 | null {
    try {
      return getAvatarReactionClip(runtimeId);
    } catch {
      return null;
    }
  }

  async loadReactionClip(runtimeId: string): Promise<AnimaPoseClipV2 | null> {
    return this.getReactionClip(runtimeId);
  }

  listReactionClips(): readonly AvatarMotionClipDescriptor[] {
    return AVATAR_REACTION_CLIP_IDS.map((runtimeId) => {
      const clip = getAvatarReactionClip(runtimeId);
      return {
        runtimeId,
        displayName: clip.name,
        description: null,
        loaded: true,
      };
    });
  }

  getReactionRuntimeId(args: {
    emotionalTone: string | null | undefined;
    emotionalIntensity: NormalizedEmotionReactionIntensity;
  }): string | null {
    const runtimeId = getEmotionReactionClipId(args);
    return runtimeId && this.getReactionClip(runtimeId) ? runtimeId : null;
  }

  getPoseIds(): readonly string[] {
    return AVATAR_POSE_IDS;
  }

  getDefaultPoseIds(): readonly string[] {
    return DEFAULT_AVATAR_POSE_IDS;
  }

  getPose(poseId: string): AnimaPose {
    return getAvatarPose(poseId);
  }

  getResolvedPose(poseId: string): ResolvedAnimaPose {
    return getResolvedAvatarPose(poseId);
  }

  getPreloadEntries(): readonly AvatarMotionPreloadEntry[] {
    return this.preloadEntries;
  }

  resolveVrma(file: string): AvatarVrmaResource | null {
    const input = file.trim();
    const url = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(input)
      ? input
      : resolveAnimationUrl(input);
    if (!url) return null;
    const runtimeId = normalizeFile(input) || input;
    return {
      runtimeId,
      url,
      cacheKey: `app:${runtimeId}:${url}`,
    };
  }

  dispose(): void {
    // The built-in singleton owns no per-Anima resources.
  }
}

/** Explicit provider for authoring/debug surfaces outside an Anima route. */
export const BUILT_IN_AVATAR_MOTION_CATALOG: AvatarMotionCatalog =
  new BuiltInAvatarMotionCatalog();
