import {
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  createDefaultAvatarEffectDocument,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResources,
} from "@/lib/avatar/vfx/editor";
import type { CreatorCameraPreset } from "@/ui/main/canvas/sceneCameraPresets";
import {
  avatarVFXEffectTransformOf,
  type AvatarVFXEffectTransform,
  type AvatarVFXParsedEntry,
} from "@/lib/avatar/vfx/types";

/** One undo step: the authored document and the image bytes it references. */
export type AvatarEffectHistorySnapshot = {
  document: AvatarEffectEditorDocument;
  imageResources: AvatarEffectEditorImageResources;
};

export const NO_AVATAR_EFFECT_IMAGES: AvatarEffectEditorImageResources = {
  image: null,
  otherEyeImage: null,
};

export function createAvatarEffectHistorySnapshot(): AvatarEffectHistorySnapshot {
  return {
    document: createDefaultAvatarEffectDocument(),
    imageResources: NO_AVATAR_EFFECT_IMAGES,
  };
}

/** Compare authored data and immutable File identities without serializing bytes. */
export function equalAvatarEffectHistorySnapshots(
  left: AvatarEffectHistorySnapshot,
  right: AvatarEffectHistorySnapshot,
): boolean {
  return (
    avatarEffectDocumentFingerprint(left.document) ===
      avatarEffectDocumentFingerprint(right.document) &&
    (["image", "otherEyeImage"] as const).every(
      (slot) =>
        left.imageResources[slot]?.file === right.imageResources[slot]?.file &&
        left.imageResources[slot]?.sha256 ===
          right.imageResources[slot]?.sha256,
    )
  );
}

/**
 * Build one undoable edit from a reducer action. `imageResources` replaces
 * the given slots' bytes in the same step; omitted slots are kept.
 */
export function avatarEffectHistoryEdit(
  action: Parameters<typeof avatarEffectEditorReducer>[1],
  imageResources?: Partial<AvatarEffectEditorImageResources>,
): (snapshot: AvatarEffectHistorySnapshot) => AvatarEffectHistorySnapshot {
  return (snapshot) => ({
    document: avatarEffectEditorReducer(snapshot.document, action),
    imageResources: imageResources
      ? { ...snapshot.imageResources, ...imageResources }
      : snapshot.imageResources,
  });
}

/** Save and recovery fingerprint: the document plus its image digests. */
export function avatarEffectSnapshotFingerprint(
  snapshot: AvatarEffectHistorySnapshot,
): string {
  return `${avatarEffectDocumentFingerprint(snapshot.document)}:${snapshot.imageResources.image?.sha256 ?? "missing"}:${snapshot.imageResources.otherEyeImage?.sha256 ?? "none"}`;
}

/**
 * The part of a preview entry that needs a fresh apply when it changes.
 * Placement is left out: it is updated in place with
 * `AvatarVFXController.updateEffectTransform`.
 */
export function avatarEffectPreviewApplyKey(
  entry: AvatarVFXParsedEntry,
): string {
  const rest: Record<string, unknown> = { ...entry };
  if (entry.kind === "body" || entry.kind === "sticker") {
    delete rest.offset;
    delete rest.size;
    delete rest.rotation;
  } else if (entry.kind !== "silhouette") {
    delete rest.transform;
  }
  return JSON.stringify(rest);
}

/**
 * How the applied preview must change between two entries: nothing, an
 * in-place transform update, or a fresh apply.
 */
export function avatarEffectPreviewChange(
  previous: AvatarVFXParsedEntry | null,
  next: AvatarVFXParsedEntry | null,
):
  | { kind: "none" }
  | { kind: "reapply" }
  | { kind: "transform"; transform: AvatarVFXEffectTransform } {
  if (!previous || !next)
    return previous === next ? { kind: "none" } : { kind: "reapply" };
  if (
    avatarEffectPreviewApplyKey(previous) !== avatarEffectPreviewApplyKey(next)
  )
    return { kind: "reapply" };
  const before = avatarVFXEffectTransformOf(previous);
  const after = avatarVFXEffectTransformOf(next);
  if (!after || JSON.stringify(before) === JSON.stringify(after))
    return { kind: "none" };
  return { kind: "transform", transform: after };
}

export type AvatarEffectCreatorKeyboardAction =
  | "save"
  | "toggle-preview"
  | null;

export function avatarEffectCreatorKeyboardAction(args: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  editing: boolean;
}): AvatarEffectCreatorKeyboardAction {
  if ((args.metaKey || args.ctrlKey) && args.key.toLowerCase() === "s")
    return "save";
  if (!args.editing && args.code === "Space") return "toggle-preview";
  return null;
}

export const AVATAR_EFFECT_PREVIEW_MOTION_CLASS =
  "motion-safe:animate-pulse motion-reduce:animate-none";

/**
 * Report compatibility only after an attempted effect application settles.
 * Clearing the controller before an async image load must remain a loading
 * state rather than briefly claiming that the Avatar is incompatible.
 */
export function avatarEffectPreviewCompatibility(args: {
  playing: boolean;
  hasController: boolean;
  hasEffect: boolean;
  applySettled: boolean;
  activeEffectCount: number;
}): boolean | null {
  if (!args.playing || !args.hasController || !args.hasEffect) return null;
  if (args.activeEffectCount > 0) return true;
  return args.applySettled ? false : null;
}

export function createAvatarEffectObjectUrlLease(
  file: File,
  api: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): { url: string; dispose: () => void } {
  const url = api.createObjectURL(file);
  let disposed = false;
  return {
    url,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      api.revokeObjectURL(url);
    },
  };
}

/**
 * The preview View an effect opens in, so its art is in frame: Face for art on
 * the eyes, mouth and face, Portrait for art above the head or on the
 * forehead (which Face crops), for body art and for stickers, and Full body
 * for a silhouette fill.
 */
export function avatarEffectInitialView(
  document: AvatarEffectEditorDocument,
): CreatorCameraPreset {
  const attachment = document.attachment;
  switch (attachment.kind) {
    case "face_surface":
      return "portrait-close";
    case "face_landmark":
      return attachment.landmark === "eyes" || attachment.landmark === "mouth"
        ? "portrait-close"
        : "portrait";
    case "body":
    case "sticker":
      return "portrait";
    case "silhouette":
      return "full-body";
  }
}
