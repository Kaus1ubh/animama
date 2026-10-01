"use client";

import { useContentEditorSaveSource } from "@/hooks/useContentEditorSaveSource";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import { saveCatalogItem } from "@/lib/content/catalogApi";
import { ContentRecoveryLifecycle } from "@/lib/content/contentRecoveryLifecycle";
import { contentSaveFieldError } from "@/lib/content/contentSaveErrors";
import {
  SCENE_EFFECT_RECOVERY_SCHEMA,
  clearSceneEffectRecovery,
  loadSceneEffectRecovery,
  saveSceneEffectRecovery,
  sceneEffectDefinition,
  sceneEffectDependencies,
  sceneEffectDocumentFingerprint,
  sceneEffectImageMetadata,
  type SceneEffectEditorDocument,
  type SceneEffectEditorImageResource,
} from "@/lib/scene-vfx/editor";
import { useSceneEffect } from "@/query/hooks/useEffects";

export type SceneEffectSaveStage =
  | "idle"
  | "preparing"
  | "uploading"
  | "validating"
  | "error";

type SaveSession = {
  operationId: string;
  resolvedName?: string;
  contentFingerprint: string;
};

/** Durable, idempotent Scene Effect save orchestration with multi-image recovery. */
export function useSceneEffectSave(args: {
  itemId?: string;
  document: SceneEffectEditorDocument;
  imageResources: SceneEffectEditorImageResource[];
  initialized: boolean;
  ready: boolean;
  onRestore: (
    document: SceneEffectEditorDocument,
    images: SceneEffectEditorImageResource[],
  ) => void;
  onSaved: (document: SceneEffectEditorDocument, savedItemId: string) => void;
}) {
  const {
    itemId,
    document,
    imageResources,
    initialized,
    ready,
    onRestore,
    onSaved,
  } = args;
  const userId = useRuntimeOwnerId();
  const existing = useSceneEffect(itemId ?? null).data;
  const {
    target: saveTargetFor,
    saved: recordSaved,
    resolveName,
  } = useContentEditorSaveSource("scene_effect", itemId, existing);
  const navigate = useNavigate();
  const documentKey = itemId ?? "new";
  const fingerprint = useMemo(
    () => sceneSaveFingerprint(document, imageResources),
    [document, imageResources],
  );
  const [stage, setStage] = useState<SceneEffectSaveStage>("idle");
  const {
    capture: captureSaveFailure,
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
    setMessage: setSaveFailureMessage,
  } = useContentSaveFailure();
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const sessionRef = useRef<SaveSession | null>(null);
  const recoveryLifecycle = useMemo(
    () => new ContentRecoveryLifecycle(),
    // Each recovery key owns an independent queue, including owner changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentKey, userId],
  );
  const pendingResetFingerprintRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const busy = ["preparing", "uploading", "validating"].includes(stage);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!userId) return;
    // Let the replacement effect run after React Strict Mode cancels its first
    // setup pass; a persistent "already restored" ref would strand Save.
    let cancelled = false;
    const generation = recoveryLifecycle.capture();
    void loadSceneEffectRecovery(userId, documentKey).then((recovery) => {
      if (cancelled || !recoveryLifecycle.isCurrent(generation)) return;
      if (recovery) {
        sessionRef.current = {
          operationId: recovery.operationId,
          contentFingerprint: recovery.contentFingerprint,
        };
        onRestore(recovery.document, recovery.imageResources);
        setRecovered(true);
        if (
          sceneEffectImageMetadata(recovery.document).length > 0 &&
          recovery.imageResources.length === 0
        )
          setRecoveryWarning(
            "This recovered draft needs its private images reselected before Save.",
          );
      }
      setRecoveryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [documentKey, onRestore, recoveryLifecycle, userId]);

  const persist = useCallback(
    async (
      session: SaveSession,
      savedDocument = {
        ...document,
        name: document.name.trim() || session.resolvedName || document.name,
      },
    ) => {
      if (!userId) return;
      const generation = recoveryLifecycle.capture();
      if (!recoveryLifecycle.isCurrent(generation)) return;
      const recovery = {
        schema: SCENE_EFFECT_RECOVERY_SCHEMA,
        userId,
        documentKey,
        operationId: session.operationId,
        document: savedDocument,
        imageResources,
        contentFingerprint: session.contentFingerprint,
        updatedAt: new Date().toISOString(),
      };
      const result = await recoveryLifecycle.write(generation, () =>
        saveSceneEffectRecovery(recovery),
      );
      if (result && recoveryLifecycle.isCurrent(generation))
        setRecoveryWarning(result.warning);
    },
    [document, documentKey, imageResources, recoveryLifecycle, userId],
  );

  useEffect(() => {
    if (!userId || !recoveryReady || !initialized || busy) return;
    if (pendingResetFingerprintRef.current !== null) {
      if (fingerprint !== pendingResetFingerprintRef.current) return;
      pendingResetFingerprintRef.current = null;
      recoveryLifecycle.resume();
    }
    const generation = recoveryLifecycle.capture();
    if (!recoveryLifecycle.isCurrent(generation)) return;
    const timeout = window.setTimeout(() => {
      if (!recoveryLifecycle.isCurrent(generation)) return;
      const session = sessionRef.current ?? {
        operationId: crypto.randomUUID(),
        contentFingerprint: fingerprint,
      };
      session.contentFingerprint = fingerprint;
      sessionRef.current = session;
      void persist(session);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    busy,
    fingerprint,
    initialized,
    persist,
    recoveryLifecycle,
    recoveryReady,
    userId,
  ]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!recoveryLifecycle.isCurrent(recoveryLifecycle.capture())) return false;
    if (!userId || !recoveryReady || !ready || (itemId && !existing) || busy)
      return false;
    setStage("preparing");
    clearSaveFailure();
    setUploadProgress(0);
    const session = sessionRef.current ?? {
      operationId: crypto.randomUUID(),
      contentFingerprint: fingerprint,
    };
    session.contentFingerprint = fingerprint;
    sessionRef.current = session;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const displayName =
        document.name.trim() ||
        session.resolvedName ||
        (await resolveName(document.name, "New Scene FX"));
      session.resolvedName = displayName;
      const savedDocument = { ...document, name: displayName };
      await persist(session, savedDocument);
      const saveTarget = saveTargetFor(displayName);
      const referenced = sceneEffectImageMetadata(document);
      const resourcesByName = new Map(
        imageResources.map((resource) => [resource.logicalName, resource]),
      );
      if (referenced.length > 0) setStage("uploading");
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
        controller.signal.throwIfAborted();
        files.push(resource.file);
        companionPaths.push(image.logicalName);
        setUploadProgress(Math.round(((index + 1) / referenced.length) * 80));
      }
      const dependencies = sceneEffectDependencies(document).map(
        (dependency) => ({
          ...dependency,
          ref:
            dependency.source.type === "builtin"
              ? dependency.source.content_id
              : dependency.source.logical_key ||
                dependency.source.catalog_item_id,
        }),
      );
      setStage("validating");
      const item = await saveCatalogItem({
        kind: "scene_effect",
        entryName: displayName,
        files,
        companionPaths,
        descriptor: {
          schema_version: 1,
          id: saveTarget.logicalKey,
          content_type: "scene_effect",
          name: displayName,
          description: document.description.trim() || undefined,
          definition: sceneEffectDefinition(document),
          dependencies,
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
          authoring: savedDocument,
        },
        operationId: session.operationId,
        catalogItemId: saveTarget.catalogItemId,
        expectedRevision: saveTarget.expectedRevision,
      });
      setUploadProgress(100);
      await recoveryLifecycle.discard(() =>
        clearSceneEffectRecovery(userId, documentKey),
      );
      recoveryLifecycle.resume();
      sessionRef.current = null;
      setRecovered(false);
      setRecoveryWarning(null);
      onSaved(savedDocument, item.item_id);
      await recordSaved(item);
      setStage("idle");
      toast.success("Scene Effect saved.");
      await navigate({
        to: "/scene-effects/$sceneEffectId/edit",
        params: { sceneEffectId: item.item_id },
        replace: true,
        ignoreBlocker: true,
      });
      return true;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setSaveFailureMessage(
          "Save paused. Retry will reuse the preserved draft.",
        );
      } else {
        captureSaveFailure(caught);
      }
      setStage("error");
      setRecovered(true);
      return false;
    } finally {
      controllerRef.current = null;
    }
  }, [
    busy,
    captureSaveFailure,
    clearSaveFailure,
    document,
    documentKey,
    existing,
    recordSaved,
    saveTargetFor,
    resolveName,
    fingerprint,
    imageResources,
    itemId,
    navigate,
    onSaved,
    persist,
    recoveryLifecycle,
    ready,
    recoveryReady,
    setSaveFailureMessage,
    userId,
  ]);

  const discardRecovery = useCallback(async () => {
    if (!userId || busy) return;
    await recoveryLifecycle.discard(() =>
      clearSceneEffectRecovery(userId, documentKey),
    );
    recoveryLifecycle.resume();
    sessionRef.current = {
      operationId: crypto.randomUUID(),
      contentFingerprint: fingerprint,
    };
    clearSaveFailure();
    setRecovered(false);
    setRecoveryWarning(null);
    setStage("idle");
    await persist(sessionRef.current);
  }, [
    busy,
    clearSaveFailure,
    documentKey,
    fingerprint,
    persist,
    recoveryLifecycle,
    userId,
  ]);

  /** Discard this key's recovery without allowing older writes or restores to revive it. */
  const discardChanges = useCallback(async (): Promise<boolean> => {
    if (
      !userId ||
      busy ||
      !recoveryLifecycle.isCurrent(recoveryLifecycle.capture())
    )
      return false;
    try {
      await recoveryLifecycle.discard(() =>
        clearSceneEffectRecovery(userId, documentKey, { strict: true }),
      );
    } catch (caught) {
      recoveryLifecycle.resume();
      throw caught;
    }
    sessionRef.current = null;
    clearSaveFailure();
    setRecovered(false);
    setRecoveryWarning(null);
    setUploadProgress(0);
    setStage("idle");
    return true;
  }, [busy, clearSaveFailure, documentKey, recoveryLifecycle, userId]);

  /** Resume recovery only after the caller replaces the old document with this fingerprint. */
  const resetSession = useCallback(
    async (nextFingerprint: string): Promise<boolean> => {
      if (!(await discardChanges())) return false;
      pendingResetFingerprintRef.current = nextFingerprint;
      sessionRef.current = {
        operationId: crypto.randomUUID(),
        contentFingerprint: nextFingerprint,
      };
      setRecoveryReady(true);
      return true;
    },
    [discardChanges],
  );

  return {
    canSave: Boolean(
      userId && recoveryReady && ready && (!itemId || existing) && !busy,
    ),
    discardRecovery,
    discardChanges,
    error,
    errorField,
    clearSaveErrorField,
    isBusy: busy,
    recovered,
    recoveryReady,
    recoveryWarning,
    resetSession,
    save,
    stage,
    uploadProgress,
  };
}

function sceneSaveFingerprint(
  document: SceneEffectEditorDocument,
  resources: SceneEffectEditorImageResource[],
) {
  const digests = [...resources]
    .sort((left, right) => left.logicalName.localeCompare(right.logicalName))
    .map((resource) => `${resource.logicalName}:${resource.sha256}`)
    .join("|");
  return `${sceneEffectDocumentFingerprint(document)}:${digests}`;
}
