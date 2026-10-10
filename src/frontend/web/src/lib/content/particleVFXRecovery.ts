import { getI18n } from "react-i18next";
import type { ParticleVFXEditorCatalogDraft } from "@/lib/avatar/particle-vfx";
import type { JsonObject } from "@/lib/avatar/particle-vfx/editor/types";
import {
  createCreatorRecoveryStore,
  creatorRecoveryTextBytes,
  recoveryRecordObject,
} from "./creatorRecoveryStore";

export const PARTICLE_VFX_RECOVERY_SCHEMA =
  "animama/particle-effect-recovery/2";
export const PARTICLE_VFX_RECOVERY_MAX_BYTES = 5 * 1024 * 1024;
const LOCAL_STORAGE_FALLBACK_MAX_BYTES = 1024 * 1024;

/** Raw authoring state only: no delivery capabilities or Blobs. */
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
  updatedAt: string;
};

/**
 * Particle Effect drafts as bounded JSON text. The storage names predate the
 * shared store and must not change, or existing drafts are lost.
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
  },
  codec: {
    measure: (recovery: ParticleVFXRecovery) =>
      creatorRecoveryTextBytes(JSON.stringify(recovery)),
    toDatabase: (recovery: ParticleVFXRecovery) => JSON.stringify(recovery),
    toFallback: (recovery: ParticleVFXRecovery) => {
      const text = JSON.stringify(recovery);
      return creatorRecoveryTextBytes(text) <= LOCAL_STORAGE_FALLBACK_MAX_BYTES
        ? { text, metadataOnly: false }
        : null;
    },
    parse: parseParticleVFXRecovery,
  },
});

function parseParticleVFXRecovery(
  value: unknown,
  identity: { userId: string; documentKey: string },
): ParticleVFXRecovery | null {
  const record = recoveryRecordObject(value);
  if (
    !record ||
    record.schema !== PARTICLE_VFX_RECOVERY_SCHEMA ||
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
    updatedAt: record.updatedAt,
  };
}
