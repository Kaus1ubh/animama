"use client";

import { useContentEditorSaveSource } from "@/hooks/useContentEditorSaveSource";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  buildParticleVFXContentPackage,
  type ParticleVFXContentPackage,
} from "@/lib/content/particleVFXContentPackage";
import {
  clearParticleVFXRecovery,
  loadParticleVFXRecovery,
  PARTICLE_VFX_RECOVERY_SCHEMA,
  saveParticleVFXRecovery,
  type ParticleVFXRecovery,
} from "@/lib/content/particleVFXRecovery";
import {
  createParticleVFXEditorDraftFromBlank,
  createParticleVFXEditorDraftFromImport,
  type ParticleVFXEditorDraft,
} from "@/lib/avatar/particle-vfx";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import { saveCatalogItem } from "@/lib/content/catalogApi";
import { useParticleEffect } from "@/query/hooks/useEffects";

export type ParticleVFXSaveStage =
  | "idle"
  | "preparing"
  | "hashing"
  | "uploading"
  | "validating"
  | "error";

type SaveSession = {
  operationId: string;
  resolvedName?: string;
  contentFingerprint: string;
};

function newSaveSession(draft: ParticleVFXEditorDraft): SaveSession {
  return {
    operationId: crypto.randomUUID(),
    contentFingerprint: authoringFingerprint(draft),
  };
}

/** Save one editor document directly into the editable Content Catalog. */
export function useParticleVFXSave({
  itemId,
  draft,
  onRestoreDraft,
  onSavedDraft,
}: {
  itemId?: string;
  draft: ParticleVFXEditorDraft | null;
  onRestoreDraft: (draft: ParticleVFXEditorDraft) => void;
  onSavedDraft: (draft: ParticleVFXEditorDraft, savedItemId: string) => void;
}) {
  const existing = useParticleEffect(itemId ?? null).data;
  const {
    target: saveTargetFor,
    saved: recordSaved,
    resolveName,
  } = useContentEditorSaveSource("particle_effect", itemId, existing);
  const navigate = useNavigate();
  const userId = useRuntimeOwnerId();
  const source = useMemo(() => (itemId ? { itemId } : null), [itemId]);
  const documentKey = itemId ?? "new";
  const [stage, setStage] = useState<ParticleVFXSaveStage>("idle");
  const {
    capture: captureSaveFailure,
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
    setMessage: setSaveFailureMessage,
  } = useContentSaveFailure();
  const [recovered, setRecovered] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
  const [notices, setNotices] = useState<readonly string[]>([]);
  const [noticeConfirmationRequired, setNoticeConfirmationRequired] =
    useState(false);
  const sessionRef = useRef<SaveSession | null>(null);
  const sessionGenerationRef = useRef(0);
  const discardingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const restoredKeyRef = useRef<string | null>(null);
  const acknowledgedNoticeFingerprintRef = useRef<string | null>(null);
  const isBusy = ["preparing", "hashing", "uploading", "validating"].includes(
    stage,
  );
  const canSave = Boolean(userId && draft && !isBusy);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    sessionGenerationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStage("idle");
    clearSaveFailure();
    setRecovered(false);
    setRecoveryReady(false);
    setRecoveryWarning(null);
    setNotices([]);
    setNoticeConfirmationRequired(false);
    sessionRef.current = null;
    restoredKeyRef.current = null;
    acknowledgedNoticeFingerprintRef.current = null;
  }, [clearSaveFailure, documentKey]);

  useEffect(() => {
    if (!userId || restoredKeyRef.current === documentKey) {
      return;
    }
    restoredKeyRef.current = documentKey;
    let cancelled = false;
    const generation = sessionGenerationRef.current;
    void loadParticleVFXRecovery(userId, source).then((recovery) => {
      if (cancelled || generation !== sessionGenerationRef.current) return;
      if (recovery) {
        try {
          const restored = createParticleVFXEditorDraftFromImport(
            recovery.quarksJson,
            recovery.catalog,
          );
          sessionRef.current = {
            operationId: recovery.operationId,
            contentFingerprint: authoringFingerprint(restored),
          };
          onRestoreDraft(restored);
          setRecovered(true);
        } catch {
          void clearParticleVFXRecovery(userId, source);
        }
      }
      setRecoveryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [documentKey, onRestoreDraft, source, userId]);

  const persistRecovery = useCallback(
    async (
      session: SaveSession,
      authoredDraft: ParticleVFXEditorDraft,
      packageFiles: ParticleVFXContentPackage,
    ) => {
      if (!userId) return;
      const recovery: ParticleVFXRecovery = {
        schema: PARTICLE_VFX_RECOVERY_SCHEMA,
        userId,
        documentKey,
        source,
        operationId: session.operationId,
        fileOperationIds: [
          `${session.operationId}-manifest`,
          ...packageFiles.textures.map(
            ({ ordinal }) => `${session.operationId}-texture-${ordinal}`,
          ),
        ],
        displayName: authoredDraft.catalog.label,
        catalog: authoredDraft.catalog,
        quarksJson: authoredDraft.quarksJson,
        updatedAt: new Date().toISOString(),
      };
      const result = await saveParticleVFXRecovery(recovery);
      setRecoveryWarning(result.warning);
      setRecovered(true);
    },
    [documentKey, source, userId],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!canSave || !draft || !userId || discardingRef.current) return false;
    const displayName = draft.catalog.label.trim();
    if (displayName.length > 120) {
      setStage("error");
      setSaveFailureMessage(
        "Give this Particle VFX a name between 1 and 120 characters.",
        "name",
      );
      return false;
    }
    setStage("preparing");
    clearSaveFailure();
    setNotices([]);
    setNoticeConfirmationRequired(false);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const session = sessionRef.current ?? newSaveSession(draft);
      sessionRef.current = session;
      const name =
        displayName ||
        session.resolvedName ||
        (await resolveName(displayName, "New Particle FX"));
      session.resolvedName = name;
      const saveTarget = saveTargetFor(name);
      const namedDraft = {
        ...draft,
        catalog: { ...draft.catalog, label: name },
      };
      const packageFiles = await buildParticleVFXContentPackage({
        draft: namedDraft,
        resources: [],
        signal: controller.signal,
      });
      setNotices(packageFiles.notices);
      const fingerprint = authoringFingerprint(draft);
      if (
        packageFiles.notices.length > 0 &&
        acknowledgedNoticeFingerprintRef.current !== fingerprint
      ) {
        acknowledgedNoticeFingerprintRef.current = fingerprint;
        setNoticeConfirmationRequired(true);
        setStage("idle");
        return false;
      }
      session.contentFingerprint = fingerprint;
      sessionRef.current = session;
      await persistRecovery(session, namedDraft, packageFiles);

      setStage("uploading");
      const manifestPath = "particle.json";
      const companionPaths = [
        manifestPath,
        ...packageFiles.textures.map(
          ({ packageReference }) => packageReference,
        ),
      ];
      const descriptor = {
        schema_version: 1,
        id: saveTarget.logicalKey,
        content_type: "particle_effect",
        name,
        description: draft.catalog.description.trim() || null,
        runtime_defaults: packageFiles.authoringManifest.runtime_defaults ?? {},
        authoring: packageFiles.authoringManifest,
        files: [
          { path: manifestPath, role: "manifest" },
          ...packageFiles.textures.map(({ packageReference }) => ({
            path: packageReference,
            role: "texture",
          })),
        ],
      };
      setStage("validating");
      const item = await saveCatalogItem({
        kind: "particle_effect",
        entryName: name,
        files: [
          packageFiles.manifestFile,
          ...packageFiles.textures.map(({ file }) => file),
        ],
        companionPaths,
        descriptor,
        operationId: session.operationId,
        catalogItemId: saveTarget.catalogItemId,
        expectedRevision: saveTarget.expectedRevision,
      });
      onSavedDraft(packageFiles.normalizedDraft, item.item_id);
      await recordSaved(item);
      await clearParticleVFXRecovery(userId, source);
      setRecovered(false);
      setRecoveryWarning(null);
      sessionRef.current = null;
      toast.success("Particle Effect saved.");
      setStage("idle");
      await navigate({
        to: "/a/particle-effects/$particleEffectId/edit",
        params: { particleEffectId: item.item_id },
        replace: true,
        ignoreBlocker: true,
      });
      return true;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setSaveFailureMessage(
          "Save paused. Retry will continue from the preserved draft.",
        );
      } else {
        captureSaveFailure(caught);
      }
      setStage("error");
      return false;
    } finally {
      controllerRef.current = null;
    }
  }, [
    canSave,
    captureSaveFailure,
    clearSaveFailure,
    draft,
    recordSaved,
    saveTargetFor,
    resolveName,
    navigate,
    onSavedDraft,
    persistRecovery,
    source,
    setSaveFailureMessage,
    userId,
  ]);

  /** Fence asynchronous restoration before discarding only this route's recovery. */
  const discardBeforeLeave = useCallback(async (): Promise<boolean> => {
    if (!userId || isBusy || controllerRef.current || discardingRef.current)
      return false;
    discardingRef.current = true;
    try {
      sessionGenerationRef.current += 1;
      await clearParticleVFXRecovery(userId, source, { strict: true });
      sessionRef.current = null;
      return true;
    } finally {
      discardingRef.current = false;
    }
  }, [isBusy, source, userId]);

  const discardRecovery = useCallback(async () => {
    if (!(await discardBeforeLeave())) return;
    setRecovered(false);
    setRecoveryWarning(null);
    clearSaveFailure();
    setStage("idle");
    onRestoreDraft(createParticleVFXEditorDraftFromBlank());
  }, [clearSaveFailure, discardBeforeLeave, onRestoreDraft]);

  /** Detach browser recovery and server-draft identity before starting over. */
  const resetSession = useCallback(
    async (nextDraft: ParticleVFXEditorDraft): Promise<boolean> => {
      if (!(await discardBeforeLeave())) return false;
      sessionRef.current = newSaveSession(nextDraft);
      restoredKeyRef.current = documentKey;
      acknowledgedNoticeFingerprintRef.current = null;
      clearSaveFailure();
      setRecovered(false);
      setRecoveryWarning(null);
      setNotices([]);
      setNoticeConfirmationRequired(false);
      setStage("idle");
      return true;
    },
    [clearSaveFailure, discardBeforeLeave, documentKey],
  );

  return {
    canSave,
    discardRecovery,
    discardBeforeLeave,
    error,
    errorField,
    clearSaveErrorField,
    isBusy,
    notices,
    noticeConfirmationRequired,
    recovered,
    recoveryReady,
    recoveryWarning,
    resetSession,
    save,
    stage,
  };
}

function authoringFingerprint(draft: ParticleVFXEditorDraft): string {
  return JSON.stringify({
    catalog: draft.catalog,
    quarksJson: draft.quarksJson,
  });
}
