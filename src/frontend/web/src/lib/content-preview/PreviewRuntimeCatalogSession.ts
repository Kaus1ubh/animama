import type {
  AvatarMotionCatalog,
  AvatarMotionClipDescriptor,
  AvatarMotionPreloadEntry,
  AvatarVrmaResource,
} from "@/lib/avatar/motion/AvatarMotionCatalog";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import type {
  AnimaPose,
  ResolvedAnimaPose,
} from "@/lib/avatar/poses/animaPose";
import type { AnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import type { NormalizedEmotionReactionIntensity } from "@/lib/avatar/reactionClips";
import type { EmotionRuntimeState } from "@/lib/emotion";
import type {
  ManifestAnimation,
  ManifestGestureEntry,
  ManifestIdleCandidateEvaluation,
  ManifestIdleSelectionResult,
} from "@/lib/avatar/animationManifest";
import type {
  ParticleVFXCatalogEntry,
  ParticleVFXPreloadTier,
} from "@/lib/avatar/particle-vfx/types";
import type { AvatarVFXCatalogEntry } from "@/lib/avatar/vfx/types";
import type {
  AnimaRuntimeMediaProvider,
  ResolvedRuntimeAudio,
  RuntimeAudioDescriptor,
} from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import type { SceneVFXEntry, SceneVFXKind } from "@/lib/scene-vfx/types";

export type PreviewRuntimeCatalogDelegate = AvatarMotionCatalog &
  AnimaRuntimeMediaProvider;

/**
 * Stable facade captured once by Avatar while disposable target catalogs change.
 * Replacement is synchronous so playback never observes a half-swapped provider.
 */
export class PreviewRuntimeCatalogSession
  implements AvatarMotionCatalog, AnimaRuntimeMediaProvider
{
  private delegate: PreviewRuntimeCatalogDelegate | null = null;

  get revision(): string {
    return this.delegate?.revision ?? "preview:empty";
  }

  replace(next: PreviewRuntimeCatalogDelegate | null): void {
    if (this.delegate === next) return;
    const previous = this.delegate;
    this.delegate = next;
    previous?.dispose();
  }

  dispose(): void {
    this.replace(null);
  }

  private get motion(): AvatarMotionCatalog {
    return this.delegate ?? BUILT_IN_AVATAR_MOTION_CATALOG;
  }

  private get media(): AnimaRuntimeMediaProvider {
    return this.delegate ?? EMPTY_RUNTIME_MEDIA_PROVIDER;
  }

  getIdleAnimations(): readonly ManifestAnimation[] {
    return this.motion.getIdleAnimations();
  }

  evaluateIdleAnimations(
    emotionalState: EmotionRuntimeState,
  ): ManifestIdleCandidateEvaluation {
    return this.motion.evaluateIdleAnimations(emotionalState);
  }

  selectIdleAnimation(args: {
    emotionalState: EmotionRuntimeState;
    randomRoll: number;
    previousFile?: string | null;
  }): ManifestIdleSelectionResult {
    return this.motion.selectIdleAnimation(args);
  }

  getGesture(
    runtimeId: string | null | undefined,
  ): ManifestGestureEntry | null {
    return this.motion.getGesture(runtimeId);
  }

  listAnimations(): readonly ManifestAnimation[] {
    return this.motion.listAnimations();
  }

  getPoseClip(runtimeId: string): AnimaPoseClip | null {
    return this.motion.getPoseClip(runtimeId);
  }

  loadPoseClip(runtimeId: string): Promise<AnimaPoseClip | null> {
    return this.motion.loadPoseClip(runtimeId);
  }

  listPoseClips(): readonly AvatarMotionClipDescriptor[] {
    return this.motion.listPoseClips();
  }

  getReactionClip(runtimeId: string): AnimaPoseClip | null {
    return this.motion.getReactionClip(runtimeId);
  }

  loadReactionClip(runtimeId: string): Promise<AnimaPoseClip | null> {
    return this.motion.loadReactionClip(runtimeId);
  }

  listReactionClips(): readonly AvatarMotionClipDescriptor[] {
    return this.motion.listReactionClips();
  }

  getReactionRuntimeId(args: {
    emotionalTone: string | null | undefined;
    emotionalIntensity: NormalizedEmotionReactionIntensity;
  }): string | null {
    return this.motion.getReactionRuntimeId(args);
  }

  getPoseIds(): readonly string[] {
    return this.motion.getPoseIds();
  }

  getDefaultPoseIds(): readonly string[] {
    return this.motion.getDefaultPoseIds();
  }

  getPose(poseId: string): AnimaPose {
    return this.motion.getPose(poseId);
  }

  getResolvedPose(poseId: string): ResolvedAnimaPose {
    return this.motion.getResolvedPose(poseId);
  }

  getPreloadEntries(): readonly AvatarMotionPreloadEntry[] {
    return this.motion.getPreloadEntries();
  }

  resolveVrma(file: string): AvatarVrmaResource | null {
    return this.motion.resolveVrma(file);
  }

  listParticleVFX(): readonly ParticleVFXCatalogEntry[] {
    return this.media.listParticleVFX();
  }

  getParticlePreloadIds(tier: ParticleVFXPreloadTier): readonly string[] {
    return this.media.getParticlePreloadIds(tier);
  }

  resolveParticleVFX(
    runtimeId: string,
  ): Promise<ParticleVFXCatalogEntry | null> {
    return this.media.resolveParticleVFX(runtimeId);
  }

  listAvatarVFX(): readonly AvatarVFXCatalogEntry[] {
    return this.media.listAvatarVFX();
  }

  resolveAvatarVFX(runtimeId: string): AvatarVFXCatalogEntry | null {
    return this.media.resolveAvatarVFX(runtimeId);
  }

  loadAvatarVFX(runtimeId: string): Promise<AvatarVFXCatalogEntry | null> {
    return this.media.loadAvatarVFX(runtimeId);
  }

  listSceneVFX(kind: SceneVFXKind): readonly SceneVFXEntry[] {
    return this.media.listSceneVFX(kind);
  }

  resolveSceneVFX(kind: SceneVFXKind, runtimeId: string): SceneVFXEntry | null {
    return this.media.resolveSceneVFX(kind, runtimeId);
  }

  loadSceneVFX(
    kind: SceneVFXKind,
    runtimeId: string,
  ): Promise<SceneVFXEntry | null> {
    return this.media.loadSceneVFX(kind, runtimeId);
  }

  listAudio(kind: "sfx"): readonly RuntimeAudioDescriptor[] {
    return this.media.listAudio(kind);
  }

  resolveAudio(
    kind: "sfx",
    runtimeId: string,
  ): Promise<ResolvedRuntimeAudio | null> {
    return this.media.resolveAudio(kind, runtimeId);
  }
}
