import { getI18n } from "react-i18next";
import type {
  ParticleVFXEditorCatalogDraft,
  ParticleVFXEditorTextureFile,
} from "@/lib/avatar/particle-vfx";
import type { JsonObject } from "@/lib/avatar/particle-vfx/editor/types";
import { PARTICLE_TEXTURE_LIMITS } from "@/lib/effects/effectArtLimits";
import {
  createCreatorRecoveryStore,
  creatorRecoveryTextBytes,
  recoveryRecordObject,
} from "./creatorRecoveryStore";

export const PARTICLE_VFX_RECOVERY_SCHEMA =
  "animama/particle-effect-recovery/3";
/** Records written before drafts carried texture files; they restore without them. */
const PARTICLE_VFX_RECOVERY_SCHEMA_V2 = "animama/particle-effect-recovery/2";
const MAX_RECOVERY_JSON_BYTES = 5 * 1024 * 1024;
/** The JSON plus every texture an effect may carry. */
export const PARTICLE_VFX_RECOVERY_MAX_BYTES =
  MAX_RECOVERY_JSON_BYTES + PARTICLE_TEXTURE_LIMITS.totalBytes;
const LOCAL_STORAGE_FALLBACK_MAX_BYTES = 1024 * 1024;

/** One texture the draft uses, with its bytes. */
export type ParticleVFXRecoveryTexture = ParticleVFXEditorTextureFile & {
  reference: string;
};

/** Raw authoring state: no delivery capabilities, only the texture Blobs. */
export type ParticleVFXRecovery = {
  schema: typeof PARTICLE_VFX_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  source: { itemId: string } | null;
  operationId: string;
  /** Kept for record compatibility; Save derives file operations itself. */
  fileOperationIds: readonly string[];
  displayName: string;
  catalog: ParticleVFXEditorCatalogDraft;
  quarksJson: JsonObject;
  textures: readonly ParticleVFXRecoveryTexture[];
  updatedAt: string;
};

/** The localStorage fallback keeps everything except the texture bytes. */
function metadata(recovery: ParticleVFXRecovery): ParticleVFXRecovery {
  return { ...recovery, textures: [] };
}

/**
 * Particle Effect drafts with the texture Blobs they use, in IndexedDB. The
 * storage names predate the shared store and must not change, or existing
 * drafts are lost.
 */
export const particleVFXRecoveryStore = createCreatorRecoveryStore({
  databaseName: "animama-content-creator-recovery",
  storeName: "particle-vfx",
  fallbackKeyPrefix: "anima.particleVfxCreator.recovery.v1",
  maxBytes: PARTICLE_VFX_RECOVERY_MAX_BYTES,
  messages: {
    tooLarge: () => {
      const t = getI18n().getFixedT(null, "library");
      return t("content.recovery.particleTooLarge");
    },
    unavailable: () => {
      const t = getI18n().getFixedT(null, "library");
      return t("content.recovery.unavailable");
    },
    metadataOnly: (recovery: ParticleVFXRecovery) => {
      if (!recovery.textures.length) return null;
      const t = getI18n().getFixedT(null, "library");
      return t("content.recovery.particleTexturesNotStored");
    },
  },
  codec: {
    measure: (recovery: ParticleVFXRecovery) =>
      creatorRecoveryTextBytes(JSON.stringify(metadata(recovery))) +
      recovery.textures.reduce((sum, texture) => sum + texture.blob.size, 0),
    toDatabase: (recovery: ParticleVFXRecovery) => recovery,
    toFallback: (recovery: ParticleVFXRecovery) => {
      const text = JSON.stringify(metadata(recovery));
      return creatorRecoveryTextBytes(text) <= LOCAL_STORAGE_FALLBACK_MAX_BYTES
        ? { text, metadataOnly: recovery.textures.length > 0 }
        : null;
    },
    parse: parseParticleVFXRecovery,
  },
});

function parseTextures(value: unknown): ParticleVFXRecoveryTexture[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const texture = recoveryRecordObject(entry);
    if (
      !texture ||
      typeof texture.reference !== "string" ||
      !(texture.blob instanceof Blob) ||
      typeof texture.sha256 !== "string" ||
      typeof texture.width !== "number" ||
      typeof texture.height !== "number"
    )
      return [];
    return [
      {
        reference: texture.reference,
        blob: texture.blob,
        sha256: texture.sha256,
        width: texture.width,
        height: texture.height,
      },
    ];
  });
}

function parseParticleVFXRecovery(
  value: unknown,
  identity: { userId: string; documentKey: string },
): ParticleVFXRecovery | null {
  const record = recoveryRecordObject(value);
  if (
    !record ||
    (record.schema !== PARTICLE_VFX_RECOVERY_SCHEMA &&
      record.schema !== PARTICLE_VFX_RECOVERY_SCHEMA_V2) ||
    record.userId !== identity.userId ||
    record.documentKey !== identity.documentKey ||
    typeof record.operationId !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.updatedAt !== "string" ||
    !Array.isArray(record.fileOperationIds) ||
    !record.fileOperationIds.every((id) => typeof id === "string") ||
    !recoveryRecordObject(record.catalog) ||
    !recoveryRecordObject(record.quarksJson)
  ) {
    return null;
  }
  const source = recoveryRecordObject(record.source);
  return {
    schema: PARTICLE_VFX_RECOVERY_SCHEMA,
    userId: identity.userId,
    documentKey: identity.documentKey,
    source:
      typeof source?.itemId === "string" ? { itemId: source.itemId } : null,
    operationId: record.operationId,
    fileOperationIds: record.fileOperationIds as string[],
    displayName: record.displayName,
    catalog: record.catalog as ParticleVFXEditorCatalogDraft,
    quarksJson: record.quarksJson as JsonObject,
    textures: parseTextures(record.textures),
    updatedAt: record.updatedAt,
  };
}
