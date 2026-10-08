import { createParticleVFXEditorDraftFromBlank } from "@/lib/avatar/particle-vfx";
import { createDefaultAvatarEffectDocument } from "@/lib/avatar/vfx/editor/defaults";
import {
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  avatarEffectRecoveryStore,
} from "@/lib/avatar/vfx/editor/recovery";
import { createDefaultSceneEffectDocument } from "@/lib/scene-vfx/editor/defaults";
import {
  SCENE_EFFECT_RECOVERY_SCHEMA,
  sceneEffectRecoveryStore,
} from "@/lib/scene-vfx/editor/recovery";
import {
  PARTICLE_VFX_RECOVERY_SCHEMA,
  particleVFXRecoveryStore,
} from "@/lib/content/particleVFXRecovery";
import { ContentRecoveryLifecycle } from "@/lib/content/contentRecoveryLifecycle";

/** A queued debounce write must also be rejected after the first write's lifetime ends. */
export function queueCreatorRecovery(userId: string) {
  const lifecycle = new ContentRecoveryLifecycle();
  const generation = lifecycle.capture();
  return Promise.all([
    lifecycle.write(generation, () => writeCreatorRecovery(userId, "running")),
    lifecycle.write(generation, () => writeCreatorRecovery(userId, "queued")),
  ]);
}

/** Exercise the actual durable creator stores, including their private Blob values. */
export function writeCreatorRecovery(userId: string, suffix = "draft") {
  const particle = createParticleVFXEditorDraftFromBlank();
  const common = {
    userId,
    documentKey: suffix,
    operationId: `operation-${suffix}`,
    updatedAt: "2026-10-05T00:00:00Z",
  };
  return Promise.all([
    particleVFXRecoveryStore.save({
      ...common,
      schema: PARTICLE_VFX_RECOVERY_SCHEMA,
      documentKey: "new",
      source: null,
      fileOperationIds: [],
      displayName: `Private particle ${suffix}`,
      catalog: particle.catalog,
      quarksJson: particle.quarksJson,
    }),
    avatarEffectRecoveryStore.save({
      ...common,
      schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
      contentFingerprint: "fixture",
      document: createDefaultAvatarEffectDocument(),
      imageResource: {
        file: new File([`private avatar ${suffix}`], "private-avatar.png"),
        sha256: "a".repeat(64),
      },
    }),
    sceneEffectRecoveryStore.save({
      ...common,
      schema: SCENE_EFFECT_RECOVERY_SCHEMA,
      contentFingerprint: "fixture",
      document: createDefaultSceneEffectDocument(),
      imageResources: [
        {
          logicalName: "private-scene.png",
          file: new File([`private scene ${suffix}`], "private-scene.png"),
          sha256: "b".repeat(64),
        },
      ],
    }),
  ]);
}

export async function creatorRecoveryRecords() {
  return Promise.all(
    [
      ["animama-content-creator-recovery", "particle-vfx"],
      ["animama-avatar-effect-creator-recovery", "drafts"],
      ["animama-scene-effect-creator-recovery", "drafts"],
    ].map(async ([name, store]) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name, 1);
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const request = database
            .transaction(store, "readonly")
            .objectStore(store)
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return Promise.all(
          records.map(async (value) => {
            const record =
              typeof value === "string" ? JSON.parse(value) : value;
            return {
              userId: record.userId as string,
              privateBytes: await Promise.all(
                [record.imageResource, ...(record.imageResources ?? [])]
                  .filter(Boolean)
                  .map((resource) => resource.file.text()),
              ),
            };
          }),
        );
      } finally {
        database.close();
      }
    }),
  );
}
