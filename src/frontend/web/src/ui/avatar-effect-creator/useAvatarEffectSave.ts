"use client";

import {
  avatarEffectDefinition,
  avatarEffectDependencies,
  avatarEffectRecoveryStore,
  avatarEffectUsesOtherEyeImage,
  AVATAR_EFFECT_OLD_DRAFT_NOTICE,
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  type AvatarEffectRecovery,
} from "@/lib/avatar/vfx/editor";
import { useAvatarEffect } from "@/query/hooks/useEffects";
import {
  CreatorRecoveryDroppedError,
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
    const { document, imageResources } = snapshot;
    const image = imageResources.image;
    if (!image) throw new Error("Choose an image before saving.");
    const otherEye = avatarEffectUsesOtherEyeImage(document)
      ? imageResources.otherEyeImage
      : null;
    if (avatarEffectUsesOtherEyeImage(document) && !otherEye)
      throw new Error("Reselect the other side image before saving.");
    progress("uploading");
    signal.throwIfAborted();
    const imagePath = document.art.image?.logicalName ?? image.file.name;
    const otherEyePath =
      otherEye &&
      (document.art.otherEyeImage?.logicalName ?? otherEye.file.name);
    const paths = [imagePath, ...(otherEyePath ? [otherEyePath] : [])];
    return {
      files: [image.file, ...(otherEye ? [otherEye.file] : [])],
      companionPaths: paths,
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
        files: paths.map((path) => ({ path, role: "image" })),
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
    imageResource: snapshot.imageResources.image,
    otherEyeImageResource: snapshot.imageResources.otherEyeImage,
    contentFingerprint: session.contentFingerprint,
    updatedAt,
  }),
  fromRecovery: (record) => {
    if (record.dropped)
      throw new CreatorRecoveryDroppedError(AVATAR_EFFECT_OLD_DRAFT_NOTICE);
    const missingImage =
      (record.document.art.image && !record.imageResource) ||
      (record.document.art.otherEyeImage && !record.otherEyeImageResource);
    return {
      snapshot: {
        document: record.document,
        imageResources: {
          image: record.imageResource,
          otherEyeImage: record.otherEyeImageResource ?? null,
        },
      },
      operationId: record.operationId,
      contentFingerprint: record.contentFingerprint,
      warning: missingImage
        ? "This recovered draft needs its images reselected before Save."
        : null,
    };
  },
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
