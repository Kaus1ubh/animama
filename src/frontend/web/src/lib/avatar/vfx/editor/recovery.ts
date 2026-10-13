import { getI18n } from "react-i18next";

import {
  createCreatorRecoveryStore,
  creatorRecoveryTextBytes,
} from "@/lib/content/creatorRecoveryStore";
import { createDefaultAvatarEffectDocument } from "./defaults";
import {
  AVATAR_EFFECT_EDITOR_SCHEMA,
  LEGACY_AVATAR_EFFECT_EDITOR_SCHEMA,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResource,
} from "./types";

export const AVATAR_EFFECT_RECOVERY_SCHEMA =
  "animama/avatar-effect-recovery/1" as const;

/** Shown once when a draft in the pre-`/2` editor format is found and dropped. */
export function avatarEffectOldDraftNotice(): string {
  const t = getI18n().getFixedT(null, "effects");
  return t("avatar.recovery.oldDraft");
}

export type AvatarEffectRecovery = {
  schema: typeof AVATAR_EFFECT_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  operationId: string;
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
  /** Bytes for `art.otherEyeImage`; absent in records written before it existed. */
  otherEyeImageResource?: AvatarEffectEditorImageResource | null;
  contentFingerprint: string;
  updatedAt: string;
  /**
   * Set when the stored draft used the pre-`/2` editor format. Its document
   * cannot be opened; restoring it drops it with
   * {@link avatarEffectOldDraftNotice}.
   */
  dropped?: "old_editor_format";
};

/** The localStorage fallback keeps everything except the image bytes. */
function metadata(recovery: AvatarEffectRecovery): AvatarEffectRecovery {
  return { ...recovery, imageResource: null, otherEyeImageResource: null };
}

/**
 * Avatar Effect drafts, with their image Blobs, in IndexedDB. The storage names
 * predate the shared store and must not change, or existing drafts are lost.
 */
export const avatarEffectRecoveryStore = createCreatorRecoveryStore({
  databaseName: "animama-avatar-effect-creator-recovery",
  storeName: "drafts",
  fallbackKeyPrefix: "anima.avatarEffectCreator.recovery.v1",
  maxBytes: 18 * 1024 * 1024,
  messages: {
    tooLarge: () => {
      const t = getI18n().getFixedT(null, "effects");
      return t("avatar.recovery.tooLarge");
    },
    unavailable: () => {
      const t = getI18n().getFixedT(null, "effects");
      return t("creator.recovery.unavailable");
    },
    metadataOnly: (recovery: AvatarEffectRecovery) => {
      const t = getI18n().getFixedT(null, "effects");
      return recovery.document.art.image
        ? t("avatar.recovery.metadataOnly")
        : null;
    },
  },
  codec: {
    measure: (recovery: AvatarEffectRecovery) =>
      creatorRecoveryTextBytes(JSON.stringify(metadata(recovery))) +
      (recovery.imageResource?.file.size ?? 0) +
      (recovery.otherEyeImageResource?.file.size ?? 0),
    toDatabase: (recovery: AvatarEffectRecovery) => recovery,
    toFallback: (recovery: AvatarEffectRecovery) => ({
      text: JSON.stringify(metadata(recovery)),
      metadataOnly: true,
    }),
    parse: parseAvatarEffectRecovery,
  },
});

function parseResource(
  value: unknown,
  fallbackName: string,
): AvatarEffectEditorImageResource | null {
  const resource = value as Partial<AvatarEffectEditorImageResource> | null;
  if (
    !resource ||
    !(resource.file instanceof Blob) ||
    typeof resource.sha256 !== "string"
  )
    return null;
  return {
    file:
      typeof File !== "undefined" && resource.file instanceof File
        ? resource.file
        : new File([resource.file], fallbackName, {
            type: resource.file.type,
          }),
    sha256: resource.sha256,
  };
}

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
    typeof record.document !== "object"
  ) {
    return null;
  }
  const schema = (record.document as { schema?: unknown }).schema;
  if (schema === LEGACY_AVATAR_EFFECT_EDITOR_SCHEMA) {
    // Surface the draft so the creator can say it was dropped.
    return {
      schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
      userId: identity.userId,
      documentKey: identity.documentKey,
      operationId: record.operationId,
      document: createDefaultAvatarEffectDocument(),
      imageResource: null,
      otherEyeImageResource: null,
      contentFingerprint: record.contentFingerprint,
      updatedAt: record.updatedAt,
      dropped: "old_editor_format",
    };
  }
  if (schema !== AVATAR_EFFECT_EDITOR_SCHEMA) return null;
  const document = record.document;
  return {
    schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
    userId: identity.userId,
    documentKey: identity.documentKey,
    operationId: record.operationId,
    document,
    imageResource: parseResource(
      record.imageResource,
      document.art?.image?.originalName ?? "effect.webp",
    ),
    otherEyeImageResource: parseResource(
      record.otherEyeImageResource,
      document.art?.otherEyeImage?.originalName ?? "effect-other.webp",
    ),
    contentFingerprint: record.contentFingerprint,
    updatedAt: record.updatedAt,
  };
}
