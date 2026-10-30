import type { PyTypedContentPreview } from "@animama/runtime-contracts/sdk";
import { getI18n } from "react-i18next";
import type { Avatar } from "@/lib/avatar";
import { getAnimaPoseClipTimelineDuration } from "@/lib/avatar/poses/animaPoseClip";
import { typedActionPreview } from "@/lib/content/typedPreviewAdapters";
import { contentPreviewFileUrl } from "@/lib/content/contentPreview";
import { actionPreviewTarget } from "@/lib/content-preview/actionPreviewTarget";
import {
  attachContentPreviewClipEventBridge,
  ContentPreviewApplySoundPlayer,
  createContentPreviewClipEventBridge,
} from "@/lib/content-preview/effects";
import {
  boundedContentPreviewFrameDelta,
  playContentPreviewMotion,
} from "@/lib/content-preview/playback";
import { PreviewRuntimeCatalogSession } from "@/lib/content-preview/PreviewRuntimeCatalogSession";
import { AnimaRuntimeCatalog } from "@/lib/runtime-content/AnimaRuntimeCatalog";
import { PreviewByteSession } from "@/lib/runtime-content/PreviewByteSession";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import { apiErrorLine } from "@/lib/errors/apiError";
import { CreatorError, creatorErrorText } from "./createAnimaErrors";

export type CreationPreviewStatus =
  | "empty"
  | "loading"
  | "ready"
  | "preparing"
  | "playing"
  | "stopped"
  | "error";

function emptyCatalog(): AnimaRuntimeCatalog {
  return new AnimaRuntimeCatalog({
    schema_version: 1,
    effective_revision: "creator:empty",
    loadout_revision: 0,
    app_catalog_version: 1,
    avatar_model: null,
    idle_animations: [],
    gestures: [],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: [],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [],
    warnings: [],
  });
}

/** Rewrite only registered capabilities to verified, session-owned Blob URLs. */
function preparedRuntime<T>(value: T, urls: Map<string, string>): T {
  if (typeof value === "string")
    return (urls.get(value) ??
      (value === "authorized_files" ? "prepared_files" : value)) as T;
  if (Array.isArray(value))
    return value.map((part) => preparedRuntime(part, urls)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, part]) => [
        key,
        preparedRuntime(part, urls),
      ]),
    ) as T;
  return value;
}

/**
 * How long a preview may keep running after its timeline ends while the
 * Avatar settles (clip fade-out, Reaction release, Avatar and particle
 * effects), so a motion that never settles still stops.
 */
export const PREVIEW_SETTLE_LIMIT_SEC = 10;

/** One creator-owned catalog and playback clock; nothing touches chat/dock state. */
export class CreateAnimaPreviewSession {
  readonly catalog = new PreviewRuntimeCatalogSession();
  avatar: Avatar | null = null;
  muted = true;
  private generation = 0;
  private controller: AbortController | null = null;
  private bytes: PreviewByteSession | null = null;
  private playing = false;
  private elapsed = 0;
  private duration: number | null = null;
  /** The clip repeats, so it is stopped after one pass instead of settling. */
  private loops = false;
  private firstFrame = true;
  private readonly audio = new ContentPreviewApplySoundPlayer();
  private readonly bridge;

  private readonly onStatus: (
    status: CreationPreviewStatus,
    message?: string,
  ) => void;
  private readonly onScene: (value: SceneVFXRuntimeEntry | null) => void;
  private readonly onFinished: () => void;
  constructor(
    onStatus: (status: CreationPreviewStatus, message?: string) => void,
    onScene: (value: SceneVFXRuntimeEntry | null) => void,
    onFinished: () => void,
  ) {
    this.onStatus = onStatus;
    this.onScene = onScene;
    this.onFinished = onFinished;
    this.catalog.replace(emptyCatalog());
    this.bridge = createContentPreviewClipEventBridge({
      catalog: this.catalog,
      onSceneVFXChange: onScene,
      playSfx: (id, signal) => {
        if (!this.muted) return this.audio.play(this.catalog, id, signal);
      },
    });
  }

  bind(avatar: Avatar): () => void {
    this.avatar = avatar;
    const detach = attachContentPreviewClipEventBridge(avatar, this.bridge);
    return () => {
      this.stop();
      detach();
      if (this.avatar === avatar) this.avatar = null;
    };
  }

  stop = (): void => {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.playing = false;
    this.avatar?.resetAnimations();
    this.avatar?.clearDebugReactionClip();
    this.avatar?.setAutomaticAnimationPlaybackEnabled(false);
    this.bridge.reset();
    this.audio.stop();
    this.onScene(null);
    this.catalog.replace(emptyCatalog());
    this.bytes?.dispose();
    this.bytes = null;
  };

  async play(
    load: (signal: AbortSignal) => Promise<PyTypedContentPreview>,
  ): Promise<void> {
    this.stop();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const current = () =>
      generation === this.generation && !controller.signal.aborted;
    // Status text is worded when it is reported, in the active UI Locale.
    const t = getI18n().getFixedT(null, "create");
    if (!this.avatar?.isReady) {
      this.onStatus("error", t("stage.waitForAvatar"));
      return;
    }
    this.onStatus("preparing", t("stage.preparingAction"));
    try {
      const preview = await load(controller.signal);
      if (!current()) return;
      const legacy = typedActionPreview(preview);
      const bytes = await PreviewByteSession.prepare(legacy, {
        signal: controller.signal,
      });
      if (!current()) {
        bytes.dispose();
        return;
      }
      this.bytes = bytes;
      const urls = new Map(
        preview.files.flatMap((file) => {
          const objectUrl = bytes.files.get(file.file_ref)?.objectUrl;
          if (!objectUrl)
            throw new CreatorError(t("stage.actionBytesUnavailable"));
          return [
            [file.url, objectUrl],
            [contentPreviewFileUrl(legacy, file), objectUrl],
          ];
        }),
      );
      const target = actionPreviewTarget(legacy, preview.item.name);
      if (target.sourceType !== "resolved_action")
        throw new CreatorError(t("stage.notAction"));
      const runtime = preparedRuntime<AnimaRuntimeCatalogSnapshot>(
        target.runtime,
        urls,
      );
      const preparedTarget = preparedRuntime({ ...target, runtime }, urls);
      this.catalog.replace(new AnimaRuntimeCatalog(runtime));
      const didPlay = await playContentPreviewMotion({
        avatar: this.avatar,
        catalog: this.catalog,
        target: preparedTarget,
        loop: false,
        isCurrent: current,
        onFinished: () => {
          if (current()) this.finish();
        },
        onMissingDependencies: (missing) => {
          if (missing.length)
            throw new CreatorError(t("stage.dependencyUnavailable"));
        },
      });
      if (!current()) return;
      if (!didPlay) throw new CreatorError(t("stage.actionNotPlayed"));
      const clip =
        target.slot === "reaction"
          ? this.catalog.getReactionClip(target.runtimeId)
          : this.catalog.getPoseClip(target.runtimeId);
      this.duration = clip
        ? Math.max(0.05, getAnimaPoseClipTimelineDuration(clip))
        : null;
      this.loops = clip?.loop === true;
      this.elapsed = 0;
      this.firstFrame = true;
      this.playing = true;
      this.onStatus("playing");
    } catch (error) {
      if (!current()) return;
      this.stop();
      this.onStatus(
        "error",
        apiErrorLine(creatorErrorText(error, t("stage.actionNotPrepared"))),
      );
    }
  }

  tick(delta: number): void {
    if (!this.playing) return;
    const elapsed = boundedContentPreviewFrameDelta(delta, this.firstFrame);
    this.firstFrame = false;
    this.elapsed += elapsed;
    const avatar = this.avatar;
    avatar?.update(elapsed);
    if (this.duration === null || this.elapsed < this.duration) return;
    // The timeline has ended, but the clip still fades out and the Reaction
    // and effects play out; keep rendering until the Avatar settles, or the
    // stage would freeze mid-motion. A looping clip never ends by itself.
    if (this.loops && avatar?.isClipActive()) {
      this.loops = false;
      avatar.stopClip();
    }
    if (
      !avatar?.isMotionActive() ||
      this.elapsed >= this.duration + PREVIEW_SETTLE_LIMIT_SEC
    )
      this.finish();
  }

  private finish(): void {
    this.stop();
    this.onStatus("stopped");
    this.onFinished();
  }
  dispose(): void {
    this.stop();
    this.catalog.dispose();
    this.avatar = null;
  }
}
