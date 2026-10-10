"use client";

import { getI18n } from "react-i18next";

import {
  createParticleVFXEditorDraftFromImport,
  type ParticleVFXEditorDraft,
} from "@/lib/avatar/particle-vfx";
import { buildParticleVFXContentPackage } from "@/lib/content/particleVFXContentPackage";
import {
  PARTICLE_VFX_RECOVERY_SCHEMA,
  particleVFXRecoveryStore,
  type ParticleVFXRecovery,
} from "@/lib/content/particleVFXRecovery";
import { useParticleEffect } from "@/query/hooks/useEffects";
import {
  useCreatorSave,
  type CreatorSaveAdapter,
} from "@/ui/content-creator/useCreatorSave";
import { particleVFXDocumentFingerprint } from "./particleVFXDocument";

const MANIFEST_PATH = "particle.json";

/**
 * Particle Effect package, recovery record and routes for the shared Save.
 * Packaging may adjust the effect; those notices are reviewed before the
 * next Save continues.
 */
export const particleVFXSaveAdapter: CreatorSaveAdapter<
  ParticleVFXEditorDraft,
  ParticleVFXRecovery
> = {
  kind: "particle_effect",
  // Getters word these when Save reads them, so they follow the UI Locale.
  get defaultName() {
    const t = getI18n().getFixedT(null, "particles");
    return t("save.defaultName");
  },
  get savedMessage() {
    const t = getI18n().getFixedT(null, "particles");
    return t("save.saved");
  },
  get pausedMessage() {
    const t = getI18n().getFixedT(null, "particles");
    return t("save.paused");
  },
  store: particleVFXRecoveryStore,
  fingerprint: particleVFXDocumentFingerprint,
  name: (draft) => draft.catalog.label,
  withName: (draft, label) => ({
    ...draft,
    catalog: { ...draft.catalog, label },
  }),
  validateName: (name) => {
    if (name.length <= 120) return null;
    const t = getI18n().getFixedT(null, "particles");
    return {
      message: t("save.nameLength", { min: 1, max: 120 }),
      field: "name",
    };
  },
  async buildPayload({ snapshot: draft, name, target, signal, progress }) {
    const packageFiles = await buildParticleVFXContentPackage({
      draft,
      resources: [],
      signal,
    });
    progress("uploading");
    return {
      files: [
        packageFiles.manifestFile,
        ...packageFiles.textures.map(({ file }) => file),
      ],
      companionPaths: [
        MANIFEST_PATH,
        ...packageFiles.textures.map(
          ({ packageReference }) => packageReference,
        ),
      ],
      descriptor: {
        schema_version: 1,
        id: target.logicalKey,
        content_type: "particle_effect",
        name,
        description: draft.catalog.description.trim() || null,
        runtime_defaults: packageFiles.authoringManifest.runtime_defaults ?? {},
        authoring: packageFiles.authoringManifest,
        files: [
          { path: MANIFEST_PATH, role: "manifest" },
          ...packageFiles.textures.map(({ packageReference }) => ({
            path: packageReference,
            role: "texture",
          })),
        ],
      },
      savedSnapshot: packageFiles.normalizedDraft,
      notices: packageFiles.notices,
    };
  },
  toRecovery: ({
    userId,
    documentKey,
    itemId,
    session,
    snapshot,
    updatedAt,
  }) => ({
    schema: PARTICLE_VFX_RECOVERY_SCHEMA,
    userId,
    documentKey,
    source: itemId ? { itemId } : null,
    operationId: session.operationId,
    fileOperationIds: [`${session.operationId}-manifest`],
    displayName: snapshot.catalog.label,
    catalog: snapshot.catalog,
    quarksJson: snapshot.quarksJson,
    updatedAt,
  }),
  // A record the current editor cannot import throws and is discarded.
  fromRecovery: (record) => ({
    snapshot: createParticleVFXEditorDraftFromImport(
      record.quarksJson,
      record.catalog,
    ),
    operationId: record.operationId,
  }),
  editRoute: (itemId) => ({
    to: "/particle-effects/$particleEffectId/edit",
    params: { particleEffectId: itemId },
  }),
};

/** Save one Particle Effect directly into the editable Content Catalog. */
export function useParticleVFXSave(
  args: Omit<
    Parameters<
      typeof useCreatorSave<ParticleVFXEditorDraft, ParticleVFXRecovery>
    >[0],
    "adapter" | "existing"
  >,
) {
  const existing = useParticleEffect(args.itemId ?? null).data;
  return useCreatorSave({ ...args, adapter: particleVFXSaveAdapter, existing });
}
