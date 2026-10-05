"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useContentEditorSaveSource } from "@/hooks/useContentEditorSaveSource";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import { saveCatalogItem } from "@/lib/content/catalogApi";
import { ContentRecoveryLifecycle } from "@/lib/content/contentRecoveryLifecycle";
import {
  AVATAR_EFFECT_RECOVERY_SCHEMA,
  avatarEffectDefinition,
  avatarEffectDependencies,
  avatarEffectDocumentFingerprint,
  clearAvatarEffectRecovery,
  loadAvatarEffectRecovery,
  saveAvatarEffectRecovery,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResource,
} from "@/lib/avatar/vfx/editor";
import { useAvatarEffect } from "@/query/hooks/useEffects";

export type AvatarEffectSaveStage =
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

export function useAvatarEffectSave(args: {
  itemId?: string;
  document: AvatarEffectEditorDocument;
  imageResource: AvatarEffectEditorImageResource | null;
  initialized: boolean;
  ready: boolean;
  onRestore: (
    document: AvatarEffectEditorDocument,
    image: AvatarEffectEditorImageResource | null,
  ) => void;
  onSaved: (document: AvatarEffectEditorDocument, savedItemId: string) => void;
}) {
  const apiClient = useProductApiClient();

  const {
    itemId,
    document,
    imageResource,
    initialized,
    ready,
    onRestore,
    onSaved,
  } = args;
  const userId = useRuntimeCacheKey();
  const existing = useAvatarEffect(itemId ?? null).data;
  const {
    target: saveTargetFor,
    saved: recordSaved,
    resolveName,
  } = useContentEditorSaveSource("avatar_effect", itemId, existing);
  const navigate = useNavigate();
  const documentKey = itemId ?? "new";
  const fingerprint = useMemo(
    () =>
      `${avatarEffectDocumentFingerprint(document)}:${imageResource?.sha256 ?? "missing"}`,
    [document, imageResource?.sha256],
  );
  const [stage, setStage] = useState<AvatarEffectSaveStage>("idle");
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
  const busy = ["preparing", "hashing", "uploading", "validating"].includes(
    stage,
  );

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!userId) return;
    // Let the replacement effect run after React Strict Mode cancels its first
    // setup pass; a persistent "already restored" ref would strand Save.
    let cancelled = false;
    const generation = recoveryLifecycle.capture();
    void loadAvatarEffectRecovery(userId, documentKey).then((recovery) => {
      if (cancelled || !recoveryLifecycle.isCurrent(generation)) return;
      if (recovery) {
        sessionRef.current = {
          operationId: recovery.operationId,
          contentFingerprint: recovery.contentFingerprint,
        };
        onRestore(recovery.document, recovery.imageResource);
        setRecovered(true);
        if (recovery.document.image && !recovery.imageResource) {
          setRecoveryWarning(
            "This recovered draft needs its image reselected before Save.",
          );
        }
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
        schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
        userId,
        documentKey,
        operationId: session.operationId,
        document: savedDocument,
        imageResource,
        contentFingerprint: session.contentFingerprint,
        updatedAt: new Date().toISOString(),
      };
      const result = await recoveryLifecycle.write(generation, () =>
        saveAvatarEffectRecovery(recovery),
      );
      if (result && recoveryLifecycle.isCurrent(generation))
        setRecoveryWarning(result.warning);
    },
    [document, documentKey, imageResource, recoveryLifecycle, userId],
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
    if (
      !userId ||
      !recoveryReady ||
      !ready ||
      !imageResource ||
      (itemId && !existing) ||
      busy
    )
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
        (await resolveName(document.name, "New Avatar FX"));
      session.resolvedName = displayName;
      const savedDocument = { ...document, name: displayName };
      await persist(session, savedDocument);
      const saveTarget = saveTargetFor(displayName);
      setStage("uploading");
      controller.signal.throwIfAborted();
      const dependencies = avatarEffectDependencies(document).map(
        (dependency) => ({
          ...dependency,
          ref:
            dependency.source.type === "builtin"
              ? dependency.source.content_id
              : dependency.source.logical_key ||
                dependency.source.catalog_item_id,
        }),
      );
      const imagePath = document.image?.logicalName ?? imageResource.file.name;
      setStage("validating");
      const item = await saveCatalogItem(apiClient, {
        kind: "avatar_effect",
        entryName: displayName,
        files: [imageResource.file],
        companionPaths: [imagePath],
        descriptor: {
          schema_version: 1,
          id: saveTarget.logicalKey,
          content_type: "avatar_effect",
          name: displayName,
          description: document.description.trim() || undefined,
          definition: avatarEffectDefinition(document),
          dependencies,
          files: [{ path: imagePath, role: "image" }],
          authoring: savedDocument,
        },
        operationId: session.operationId,
        catalogItemId: saveTarget.catalogItemId,
        expectedRevision: saveTarget.expectedRevision,
      });
      setUploadProgress(100);
      await recoveryLifecycle.discard(() =>
        clearAvatarEffectRecovery(userId, documentKey),
      );
      recoveryLifecycle.resume();
      sessionRef.current = null;
      setRecovered(false);
      setRecoveryWarning(null);
      onSaved(savedDocument, item.item_id);
      await recordSaved(item);
      setStage("idle");
      toast.success("Avatar Effect saved.");
      await navigate({
        to: "/avatar-effects/$avatarEffectId/edit",
        params: { avatarEffectId: item.item_id },
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
    apiClient,
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
    imageResource,
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
      clearAvatarEffectRecovery(userId, documentKey),
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
    const nextSession = sessionRef.current;
    await persist(nextSession);
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
        clearAvatarEffectRecovery(userId, documentKey, { strict: true }),
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
      userId &&
      recoveryReady &&
      ready &&
      imageResource &&
      (!itemId || existing) &&
      !busy,
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
