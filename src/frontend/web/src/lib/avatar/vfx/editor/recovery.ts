import {
  createCreatorRecoveryStore,
  creatorRecoveryTextBytes,
} from "@/lib/content/creatorRecoveryStore";
import type {
  AvatarEffectEditorDocument,
  AvatarEffectEditorImageResource,
} from "./types";

export const AVATAR_EFFECT_RECOVERY_SCHEMA =
  "animama/avatar-effect-recovery/1" as const;

export type AvatarEffectRecovery = {
  schema: typeof AVATAR_EFFECT_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  operationId: string;
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
  contentFingerprint: string;
  updatedAt: string;
};

/** The localStorage fallback keeps everything except the image bytes. */
function metadata(recovery: AvatarEffectRecovery): AvatarEffectRecovery {
  return { ...recovery, imageResource: null };
}

/**
 * Avatar Effect drafts, with their image Blob, in IndexedDB. The storage names
 * predate the shared store and must not change, or existing drafts are lost.
 */
export const avatarEffectRecoveryStore = createCreatorRecoveryStore({
  databaseName: "animama-avatar-effect-creator-recovery",
  storeName: "drafts",
  fallbackKeyPrefix: "anima.avatarEffectCreator.recovery.v1",
  maxBytes: 18 * 1024 * 1024,
  messages: {
    tooLarge:
      "This image is too large for browser crash recovery. Keep this tab open until Save completes.",
    unavailable:
      "Browser crash recovery is unavailable. Keep this tab open until Save completes.",
    metadataOnly: (recovery: AvatarEffectRecovery) =>
      recovery.document.image
        ? "Image bytes could not be stored for crash recovery. Reselect the image after restoring this draft."
        : null,
  },
  codec: {
    measure: (recovery: AvatarEffectRecovery) =>
      creatorRecoveryTextBytes(JSON.stringify(metadata(recovery))) +
      (recovery.imageResource?.file.size ?? 0),
    toDatabase: (recovery: AvatarEffectRecovery) => recovery,
    toFallback: (recovery: AvatarEffectRecovery) => ({
      text: JSON.stringify(metadata(recovery)),
      metadataOnly: true,
    }),
    parse: parseAvatarEffectRecovery,
  },
});

function parseAvatarEffectRecovery(
  value: unknown,
  identity: { userId: string; documentKey: string },
): AvatarEffectRecovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<AvatarEffectRecovery>;
  if (
    record.schema !== AVATAR_EFFECT_RECOVERY_SCHEMA ||
    record.userId !== identity.userId ||
    record.documentKey !== identity.documentKey ||
    typeof record.operationId !== "string" ||
    typeof record.contentFingerprint !== "string" ||
    typeof record.updatedAt !== "string" ||
    !record.document ||
    record.document.schema !== "animama/avatar-effect-editor/1"
  ) {
    return null;
  }
  const resource = record.imageResource;
  let imageResource: AvatarEffectEditorImageResource | null = null;
  if (
    resource &&
    resource.file instanceof Blob &&
    typeof resource.sha256 === "string"
  ) {
    imageResource = {
      file:
        typeof File !== "undefined" && resource.file instanceof File
          ? resource.file
          : new File(
              [resource.file],
              record.document.image?.originalName ?? "effect.webp",
              { type: resource.file.type },
            ),
      sha256: resource.sha256,
    };
  }
  return {
    schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
    userId: identity.userId,
    documentKey: identity.documentKey,
    operationId: record.operationId,
    document: record.document,
    imageResource,
    contentFingerprint: record.contentFingerprint,
    updatedAt: record.updatedAt,
  };
}
