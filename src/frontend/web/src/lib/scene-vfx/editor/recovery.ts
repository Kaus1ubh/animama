import {
  createCreatorRecoveryStore,
  creatorRecoveryTextBytes,
} from "@/lib/content/creatorRecoveryStore";
import type {
  SceneEffectEditorDocument,
  SceneEffectEditorImageResource,
} from "./types";

export const SCENE_EFFECT_RECOVERY_SCHEMA =
  "animama/scene-effect-recovery/1" as const;

export type SceneEffectRecovery = {
  schema: typeof SCENE_EFFECT_RECOVERY_SCHEMA;
  userId: string;
  documentKey: string;
  operationId: string;
  document: SceneEffectEditorDocument;
  imageResources: SceneEffectEditorImageResource[];
  contentFingerprint: string;
  updatedAt: string;
};

/** The localStorage fallback keeps everything except the image bytes. */
function metadata(recovery: SceneEffectRecovery): SceneEffectRecovery {
  return { ...recovery, imageResources: [] };
}

/**
 * Scene Effect drafts, with their private image Blobs, in IndexedDB. The
 * storage names predate the shared store and must not change.
 */
export const sceneEffectRecoveryStore = createCreatorRecoveryStore({
  databaseName: "animama-scene-effect-creator-recovery",
  storeName: "drafts",
  fallbackKeyPrefix: "anima.sceneEffectCreator.recovery.v1",
  maxBytes: 34 * 1024 * 1024,
  messages: {
    tooLarge:
      "These images are too large for browser crash recovery. Keep this tab open until Save completes.",
    unavailable:
      "Browser crash recovery is unavailable. Keep this tab open until Save completes.",
    metadataOnly: (recovery: SceneEffectRecovery) =>
      recovery.imageResources.length
        ? "Image bytes could not be stored for crash recovery. Reselect private images after restoring this draft."
        : null,
  },
  codec: {
    measure: (recovery: SceneEffectRecovery) =>
      creatorRecoveryTextBytes(JSON.stringify(metadata(recovery))) +
      recovery.imageResources.reduce(
        (sum, resource) => sum + resource.file.size,
        0,
      ),
    toDatabase: (recovery: SceneEffectRecovery) => recovery,
    toFallback: (recovery: SceneEffectRecovery) => ({
      text: JSON.stringify(metadata(recovery)),
      metadataOnly: true,
    }),
    parse: parseSceneEffectRecovery,
  },
});

function parseSceneEffectRecovery(
  value: unknown,
  identity: { userId: string; documentKey: string },
): SceneEffectRecovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<SceneEffectRecovery>;
  if (
    record.schema !== SCENE_EFFECT_RECOVERY_SCHEMA ||
    record.userId !== identity.userId ||
    record.documentKey !== identity.documentKey ||
    typeof record.operationId !== "string" ||
    typeof record.contentFingerprint !== "string" ||
    typeof record.updatedAt !== "string" ||
    record.document?.schema !== "animama/scene-effect-editor/1"
  )
    return null;
  const resources = Array.isArray(record.imageResources)
    ? record.imageResources.flatMap((resource) => {
        if (
          !resource ||
          !(resource.file instanceof Blob) ||
          typeof resource.logicalName !== "string" ||
          typeof resource.sha256 !== "string"
        )
          return [];
        const file =
          typeof File !== "undefined" && resource.file instanceof File
            ? resource.file
            : new File([resource.file], resource.logicalName, {
                type: resource.file.type,
              });
        return [
          { logicalName: resource.logicalName, file, sha256: resource.sha256 },
        ];
      })
    : [];
  return {
    schema: SCENE_EFFECT_RECOVERY_SCHEMA,
    userId: identity.userId,
    documentKey: identity.documentKey,
    operationId: record.operationId,
    document: record.document,
    imageResources: resources,
    contentFingerprint: record.contentFingerprint,
    updatedAt: record.updatedAt,
  };
}
