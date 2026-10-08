"use client";

import { contentSaveFieldError } from "@/lib/content/contentSaveErrors";
import {
  SCENE_EFFECT_RECOVERY_SCHEMA,
  sceneEffectDefinition,
  sceneEffectDependencies,
  sceneEffectImageMetadata,
  sceneEffectRecoveryStore,
  type SceneEffectRecovery,
} from "@/lib/scene-vfx/editor";
import { useSceneEffect } from "@/query/hooks/useEffects";
import {
  useCreatorSave,
  type CreatorSaveAdapter,
} from "@/ui/content-creator/useCreatorSave";
import {
  sceneEffectSnapshotFingerprint,
  type SceneEffectHistorySnapshot,
} from "./sceneEffectCreatorBehavior";

/** Scene Effect payload (with private images), recovery record and routes. */
export const sceneEffectSaveAdapter: CreatorSaveAdapter<
  SceneEffectHistorySnapshot,
  SceneEffectRecovery
> = {
  kind: "scene_effect",
  defaultName: "New Scene FX",
  savedMessage: "Scene Effect saved.",
  pausedMessage: "Save paused. Retry will reuse the preserved draft.",
  store: sceneEffectRecoveryStore,
  fingerprint: sceneEffectSnapshotFingerprint,
  name: (snapshot) => snapshot.document.name,
  withName: (snapshot, name) => ({
    ...snapshot,
    document: { ...snapshot.document, name },
  }),
  async buildPayload({ snapshot, name, target, signal, progress }) {
    const { document, imageResources } = snapshot;
    const referenced = sceneEffectImageMetadata(document);
    const resourcesByName = new Map(
      imageResources.map((resource) => [resource.logicalName, resource]),
    );
    if (referenced.length > 0) progress("uploading");
    const files: File[] = [];
    const companionPaths: string[] = [];
    for (let index = 0; index < referenced.length; index += 1) {
      const image = referenced[index];
      const resource = resourcesByName.get(image.logicalName);
      if (!resource)
        throw contentSaveFieldError(
          `Reselect ${image.originalName} before saving.`,
          "files",
        );
      signal.throwIfAborted();
      files.push(resource.file);
      companionPaths.push(image.logicalName);
      progress("uploading", Math.round(((index + 1) / referenced.length) * 80));
    }
    return {
      files,
      companionPaths,
      descriptor: {
        schema_version: 1,
        id: target.logicalKey,
        content_type: "scene_effect",
        name,
        description: document.description.trim() || undefined,
        definition: sceneEffectDefinition(document),
        dependencies: sceneEffectDependencies(document).map((dependency) => ({
          ...dependency,
          ref:
            dependency.source.type === "builtin"
              ? dependency.source.content_id
              : dependency.source.logical_key ||
                dependency.source.catalog_item_id,
        })),
        files: referenced.map(({ logicalName }) => ({
          path: logicalName,
          role: "image",
        })),
        logical_resource_files: Object.fromEntries(
          referenced.map(({ logicalName }, index) => [
            logicalName,
            { role: "image", ordinal: index + 2 },
          ]),
        ),
        authoring: document,
      },
      savedSnapshot: snapshot,
    };
  },
  toRecovery: ({ userId, documentKey, session, snapshot, updatedAt }) => ({
    schema: SCENE_EFFECT_RECOVERY_SCHEMA,
    userId,
    documentKey,
    operationId: session.operationId,
    document: snapshot.document,
    imageResources: snapshot.imageResources,
    contentFingerprint: session.contentFingerprint,
    updatedAt,
  }),
  fromRecovery: (record) => ({
    snapshot: {
      document: record.document,
      imageResources: record.imageResources,
    },
    operationId: record.operationId,
    contentFingerprint: record.contentFingerprint,
    warning:
      sceneEffectImageMetadata(record.document).length > 0 &&
      record.imageResources.length === 0
        ? "This recovered draft needs its private images reselected before Save."
        : null,
  }),
  editRoute: (itemId) => ({
    to: "/scene-effects/$sceneEffectId/edit",
    params: { sceneEffectId: itemId },
  }),
};

/** Durable, idempotent Scene Effect Save with multi-image recovery. */
export function useSceneEffectSave(
  args: Omit<
    Parameters<
      typeof useCreatorSave<SceneEffectHistorySnapshot, SceneEffectRecovery>
    >[0],
    "adapter" | "existing"
  >,
) {
  const existing = useSceneEffect(args.itemId ?? null).data;
  return useCreatorSave({ ...args, adapter: sceneEffectSaveAdapter, existing });
}
