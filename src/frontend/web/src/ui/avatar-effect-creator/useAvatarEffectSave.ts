"use client";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  localContentLogicalKey,
  saveCatalogItem,
} from "@/lib/content/catalogApi";
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
  onSaved: (document: AvatarEffectEditorDocument) => void;
}) {
  const {
    itemId,
    document,
    imageResource,
    initialized,
    ready,
    onRestore,
    onSaved,
  } = args;
  const userId = useRuntimeOwnerId();
  const existing = useAvatarEffect(itemId ?? null).data;
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
  const sessionGenerationRef = useRef(0);
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
    void loadAvatarEffectRecovery(userId, documentKey).then((recovery) => {
      if (cancelled) return;
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
  }, [documentKey, onRestore, userId]);

  const persist = useCallback(
    async (session: SaveSession) => {
      if (!userId) return;
      const result = await saveAvatarEffectRecovery({
        schema: AVATAR_EFFECT_RECOVERY_SCHEMA,
        userId,
        documentKey,
        operationId: session.operationId,
        document,
        imageResource,
        contentFingerprint: session.contentFingerprint,
        updatedAt: new Date().toISOString(),
      });
      setRecoveryWarning(result.warning);
    },
    [document, documentKey, imageResource, userId],
  );

  useEffect(() => {
    if (!userId || !recoveryReady || !initialized || busy) return;
    const generation = sessionGenerationRef.current;
    const timeout = window.setTimeout(() => {
      if (generation !== sessionGenerationRef.current) return;
      const session = sessionRef.current ?? {
        operationId: crypto.randomUUID(),
        contentFingerprint: fingerprint,
      };
      session.contentFingerprint = fingerprint;
      sessionRef.current = session;
      void persist(session);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [busy, fingerprint, initialized, persist, recoveryReady, userId]);

  const save = useCallback(async (): Promise<boolean> => {
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
      await persist(session);
      const displayName = document.name.trim();
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
      const item = await saveCatalogItem({
        kind: "avatar_effect",
        entryName: displayName,
        files: [imageResource.file],
        companionPaths: [imagePath],
        descriptor: {
          schema_version: 1,
          id:
            existing?.logical_key ??
            localContentLogicalKey("avatar_effect", displayName),
          content_type: "avatar_effect",
          name: displayName,
          description: document.description.trim() || undefined,
          definition: avatarEffectDefinition(document),
          dependencies,
          files: [{ path: imagePath, role: "image" }],
          authoring: document,
        },
        operationId: session.operationId,
        catalogItemId: existing?.item_id,
        expectedRevision: existing?.revision_sha256,
      });
      setUploadProgress(100);
      await clearAvatarEffectRecovery(userId, documentKey);
      sessionRef.current = null;
      setRecovered(false);
      setRecoveryWarning(null);
      setStage("idle");
      onSaved(document);
      toast.success("Avatar Effect saved.");
      await navigate({
        to: "/a/avatar-effects/$avatarEffectId/edit",
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
    busy,
    captureSaveFailure,
    clearSaveFailure,
    document,
    documentKey,
    existing,
    fingerprint,
    imageResource,
    itemId,
    navigate,
    onSaved,
    persist,
    ready,
    recoveryReady,
    setSaveFailureMessage,
    userId,
  ]);

  const discardRecovery = useCallback(async () => {
    if (!userId || busy) return;
    await clearAvatarEffectRecovery(userId, documentKey);
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
  }, [busy, clearSaveFailure, documentKey, fingerprint, persist, userId]);

  /** Discard the current browser recovery/session before starting a blank document. */
  const resetSession = useCallback(
    async (nextFingerprint: string): Promise<boolean> => {
      if (!userId || busy) return false;
      sessionGenerationRef.current += 1;
      controllerRef.current?.abort();
      await clearAvatarEffectRecovery(userId, documentKey);
      sessionRef.current = {
        operationId: crypto.randomUUID(),
        contentFingerprint: nextFingerprint,
      };
      clearSaveFailure();
      setRecovered(false);
      setRecoveryWarning(null);
      setUploadProgress(0);
      setStage("idle");
      return true;
    },
    [busy, clearSaveFailure, documentKey, userId],
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
