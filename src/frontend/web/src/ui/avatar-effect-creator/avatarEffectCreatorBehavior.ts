import {
  avatarEffectDocumentFingerprint,
  avatarEffectEditorReducer,
  createDefaultAvatarEffectDocument,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResource,
} from "@/lib/avatar/vfx/editor";

/** One undo step: the authored document and the image bytes it references. */
export type AvatarEffectHistorySnapshot = {
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
};

export function createAvatarEffectHistorySnapshot(): AvatarEffectHistorySnapshot {
  return { document: createDefaultAvatarEffectDocument(), imageResource: null };
}

/** Compare authored data and immutable File identities without serializing bytes. */
export function equalAvatarEffectHistorySnapshots(
  left: AvatarEffectHistorySnapshot,
  right: AvatarEffectHistorySnapshot,
): boolean {
  return (
    avatarEffectDocumentFingerprint(left.document) ===
      avatarEffectDocumentFingerprint(right.document) &&
    left.imageResource?.file === right.imageResource?.file &&
    left.imageResource?.sha256 === right.imageResource?.sha256
  );
}

/**
 * Build one undoable edit from a reducer action. Omitting `imageResource`
 * keeps the current bytes; `null` clears them with the same step.
 */
export function avatarEffectHistoryEdit(
  action: Parameters<typeof avatarEffectEditorReducer>[1],
  imageResource?: AvatarEffectEditorImageResource | null,
): (snapshot: AvatarEffectHistorySnapshot) => AvatarEffectHistorySnapshot {
  return (snapshot) => ({
    document: avatarEffectEditorReducer(snapshot.document, action),
    imageResource:
      imageResource === undefined ? snapshot.imageResource : imageResource,
  });
}

/** Save and recovery fingerprint: the document plus its image digest. */
export function avatarEffectSnapshotFingerprint(
  snapshot: AvatarEffectHistorySnapshot,
): string {
  return `${avatarEffectDocumentFingerprint(snapshot.document)}:${snapshot.imageResource?.sha256 ?? "missing"}`;
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
