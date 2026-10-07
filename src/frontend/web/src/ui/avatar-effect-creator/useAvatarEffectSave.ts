"use client";

import {
  avatarEffectDefinition,
  avatarEffectDependencies,
  avatarEffectRecoveryStore,
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  type AvatarEffectRecovery,
} from "@/lib/avatar/vfx/editor";
import { useAvatarEffect } from "@/query/hooks/useEffects";
import {
  useCreatorSave,
  type CreatorSaveAdapter,
} from "@/ui/content-creator/useCreatorSave";
import {
  avatarEffectSnapshotFingerprint,
  type AvatarEffectHistorySnapshot,
} from "./avatarEffectCreatorBehavior";

/** Avatar Effect payload, recovery record and routes for the shared Save. */
export const avatarEffectSaveAdapter: CreatorSaveAdapter<
  AvatarEffectHistorySnapshot,
  AvatarEffectRecovery
> = {
  kind: "avatar_effect",
  defaultName: "New Avatar FX",
  savedMessage: "Avatar Effect saved.",
  pausedMessage: "Save paused. Retry will reuse the preserved draft.",
  store: avatarEffectRecoveryStore,
  fingerprint: avatarEffectSnapshotFingerprint,
  name: (snapshot) => snapshot.document.name,
  withName: (snapshot, name) => ({
    ...snapshot,
    document: { ...snapshot.document, name },
  }),
  async buildPayload({ snapshot, name, target, signal, progress }) {
    const { document, imageResource } = snapshot;
    if (!imageResource) throw new Error("Choose an image before saving.");
    progress("uploading");
    signal.throwIfAborted();
    const imagePath = document.image?.logicalName ?? imageResource.file.name;
    return {
      files: [imageResource.file],
      companionPaths: [imagePath],
      descriptor: {
        schema_version: 1,
        id: target.logicalKey,
        content_type: "avatar_effect",
        name,
        description: document.description.trim() || undefined,
        definition: avatarEffectDefinition(document),
        dependencies: avatarEffectDependencies(document).map((dependency) => ({
          ...dependency,
          ref:
            dependency.source.type === "builtin"
              ? dependency.source.content_id
              : dependency.source.logical_key ||
                dependency.source.catalog_item_id,
        })),
        files: [{ path: imagePath, role: "image" }],
        authoring: document,
      },
      savedSnapshot: snapshot,
    };
  },
  toRecovery: ({ userId, documentKey, session, snapshot, updatedAt }) => ({
    schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
    userId,
    documentKey,
    operationId: session.operationId,
    document: snapshot.document,
    imageResource: snapshot.imageResource,
    contentFingerprint: session.contentFingerprint,
    updatedAt,
  }),
  fromRecovery: (record) => ({
    snapshot: {
      document: record.document,
      imageResource: record.imageResource,
    },
    operationId: record.operationId,
    contentFingerprint: record.contentFingerprint,
    warning:
      record.document.image && !record.imageResource
        ? "This recovered draft needs its image reselected before Save."
        : null,
  }),
  editRoute: (itemId) => ({
    to: "/avatar-effects/$avatarEffectId/edit",
    params: { avatarEffectId: itemId },
  }),
};

/** Durable, idempotent Avatar Effect Save with browser recovery. */
export function useAvatarEffectSave(
  args: Omit<
    Parameters<
      typeof useCreatorSave<AvatarEffectHistorySnapshot, AvatarEffectRecovery>
    >[0],
    "adapter" | "existing"
  >,
) {
  const existing = useAvatarEffect(args.itemId ?? null).data;
  return useCreatorSave({
    ...args,
    adapter: avatarEffectSaveAdapter,
    existing,
  });
}
