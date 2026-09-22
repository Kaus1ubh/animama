"use client";

import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  PyCatalogViewItem,
  PyGesture,
  PyReaction,
} from "@/lib/content/catalogTypes";
import { contentSaveFieldError } from "@/lib/content/contentSaveErrors";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  clearActionRecovery,
  clearActionRecoveryForNewDocument,
  loadActionRecoveryForEditorRoute,
  actionDocumentDigest,
  saveActionRecovery,
} from "@/lib/content/actionRecovery";
import {
  contentFileFingerprint,
  sha256File,
} from "@/lib/content/contentUploads";
import {
  creatorActionPreviewRuntime,
  actionPreviewTarget,
} from "@/lib/content-preview/actionPreviewTarget";
import { actionComponentSandboxEntries } from "@/lib/content-preview/actionComponentSandbox";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import {
  useAvatarEffectsPage,
  useParticleEffects,
  useActionComponent,
  useSceneEffectsPage,
  useSoundEffects,
  type ActionComponentType,
} from "@/query/hooks/useEffects";
import { useAction } from "@/query/hooks/useActions";
import { useActionComponentPreviews } from "@/query/hooks/useActionComponentPreviews";
import {
  type EditSessionIdentity,
  useActionEditorActions,
} from "@/query/mutations/useActionEditorActions";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { useCreatorHistory } from "@/ui/creator-history/CreatorHistory";
import { createGestureDocument } from "@/ui/gesture-editor/gestureDocument";
import { createReactionDocument } from "@/ui/reaction-editor/reactionDocument";
import {
  addActionComponentEvent,
  mapActionDependency,
  removeActionDependency,
} from "./actionDependencies";
import {
  actionDocumentForPersistence,
  canonicalizeActionComponentInsertion,
} from "./actionPersistence";
import { ActionEditorPreviewProvider } from "./ActionEditorPreviewProvider";
import { ActionEditorWorkspace } from "./ActionEditorWorkspace";
import {
  ActionEditorWorkspaceProvider,
  type ActionDependencySection,
  type ActionSaveStage,
} from "./ActionEditorWorkspaceContext";
import {
  applyActionAuthoringSnapshot,
  normalizeActionDocument,
  actionAuthoringSnapshot,
  actionAuthoringSnapshotsEqual,
  hasHumanoidTracks,
  renameActionDocument,
  referencedAliases,
  validateActionDocument,
  type ActionDocument,
  type ActionIntent,
} from "./actionDocument";
import { actionEditorCapabilities } from "./actionEditorCapabilities";
import {
  isCustomizableStarterAction,
  actionDocumentFromPreview,
} from "./actionDocumentLoader";
import type { ActionImport } from "./actionProject";
import { unresolvedActionReferences } from "./actionProject";
import {
  ActionManageDialog,
  type ManageActionTarget,
} from "@/ui/action-manage/ActionManageDialog";

function componentRows(value: unknown): PyCatalogViewItem[] {
  if (!value || typeof value !== "object") return [];
  const pages = (value as { pages?: Array<{ items: PyCatalogViewItem[] }> })
    .pages;
  return pages?.flatMap((page) => page.items) ?? [];
}

function queryErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error
    ? error.message
    : "This effect catalog could not be loaded.";
}

function exactSourceKey(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const value = source as Record<string, unknown>;
  if (value.type === "catalog" && typeof value.catalog_item_id === "string")
    return `catalog:${value.catalog_item_id}`;
  if (
    value.type === "builtin" &&
    typeof value.content_id === "string" &&
    typeof value.version === "number"
  )
    return `builtin:${value.content_id}@${value.version}`;
  return null;
}

/** Typed draft orchestration; all visual authoring lives in the workspace. */
export function ActionEditorPage({
  intent,
  itemId,
  initialComponent,
  initialComponentType,
}: {
  intent: ActionIntent;
  itemId?: string;
  initialComponent?: string;
  initialComponentType?: ActionComponentType;
}) {
  const createDocument = useCallback(
    () =>
      intent === "gesture" ? createGestureDocument() : createReactionDocument(),
    [intent],
  );
  const [document, setDocument] = useState<ActionDocument>(createDocument);
  const cleanDigest = useRef(actionDocumentDigest(document));
  const documentRef = useRef(document);
  documentRef.current = document;
  const [identity, setIdentity] = useState<EditSessionIdentity | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(
    itemId ?? null,
  );
  const [vrma, setVrma] = useState<File | null>(null);
  const [uploadedRootFile, setUploadedRootFile] = useState<{
    sessionId: string;
    fileRef: string;
    fingerprint: string;
  } | null>(null);
  const [dependencyQuery, setDependencyQuery] = useState("");
  const [activeDependencyType, setActiveDependencyType] =
    useState<ActionComponentType>("particle_effect");
  const [timelineSession, setTimelineSession] = useState(0);
  const {
    capture: captureSaveFailure,
    clear: clearSaveFailure,
    clearField: clearSaveErrorField,
    error,
    errorField,
    setMessage: setFailureMessage,
  } = useContentSaveFailure();
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [saveStage, setSaveStage] = useState<ActionSaveStage>("idle");
  const [manageTarget, setManageTarget] = useState<ManageActionTarget | null>(
    null,
  );
  const [previewRuntime, setPreviewRuntime] =
    useState<AnimaRuntimeCatalogSnapshot | null>(null);
  const [rootPreviewDependencyDigest, setRootPreviewDependencyDigest] =
    useState<string | null>(null);
  const capabilities = actionEditorCapabilities(intent);
  const [mode, setMode] = useState(capabilities.defaultMode);
  const hydrated = useRef(false);
  const hydrating = useRef(false);
  const [hydrationReady, setHydrationReady] = useState(false);
  const finalized = useRef(false);
  const internalNavigation = useRef(false);
  const initialComponentApplied = useRef(false);
  const actions = useActionEditorActions(intent);
  const userId = useRuntimeOwnerId();
  const navigate = useNavigate();
  const existing = useAction(intent, itemId ?? null);
  const previewDependenciesRef = useRef({
    digest: JSON.stringify(document.dependencies),
    value: document.dependencies,
  });
  const dependencyDigest = JSON.stringify(document.dependencies);
  if (previewDependenciesRef.current.digest !== dependencyDigest) {
    previewDependenciesRef.current = {
      digest: dependencyDigest,
      value: document.dependencies,
    };
  }
  const componentPreviews = useActionComponentPreviews(
    previewDependenciesRef.current.value,
    { enabled: rootPreviewDependencyDigest !== dependencyDigest },
  );
  const sandboxEntries = useMemo(
    () =>
      componentPreviews.previews.flatMap(({ dependency, preview }) =>
        actionComponentSandboxEntries(preview, dependency),
      ),
    [componentPreviews.previews],
  );

  const applyHistorySnapshot = useCallback(
    (snapshot: ReturnType<typeof actionAuthoringSnapshot>) =>
      setDocument((current) => applyActionAuthoringSnapshot(current, snapshot)),
    [],
  );
  const history = useCreatorHistory({
    initialValue: actionAuthoringSnapshot(document),
    onApply: applyHistorySnapshot,
    equals: actionAuthoringSnapshotsEqual,
  });
  const historyRef = useRef(history);
  historyRef.current = history;

  const replaceLoadedDocument = useCallback(
    (next: ActionDocument, clean = false) => {
      const normalized = normalizeActionDocument(next);
      setValidationAttempted(false);
      setDocument(normalized);
      setTimelineSession((value) => value + 1);
      historyRef.current.reset(actionAuthoringSnapshot(normalized));
      if (clean) cleanDigest.current = actionDocumentDigest(normalized);
    },
    [],
  );

  const issues = useMemo(() => validateActionDocument(document), [document]);
  const busy =
    actions.beginSession.isPending ||
    actions.updateSession.isPending ||
    actions.starterPreview.isPending ||
    actions.stageFile.isPending ||
    actions.save.isPending ||
    saveStage !== "idle";
  const dirty = actionDocumentDigest(document) !== cleanDigest.current;
  useEffect(() => {
    // A successful save only suppresses recovery/navigation guards until
    // the creator makes the next authoring change in this mounted editor.
    if (dirty) finalized.current = false;
  }, [dirty]);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !internalNavigation.current &&
      !finalized.current &&
      (dirty || busy) &&
      current.pathname !== next.pathname,
    enableBeforeUnload: () => !finalized.current && (dirty || busy),
    withResolver: true,
  });

  const unresolvedDependencyTypes = useMemo(() => {
    try {
      return new Set(
        unresolvedActionReferences(
          document.sequence,
          document.dependencies,
        ).map((reference) => reference.contentType),
      );
    } catch {
      return new Set<ActionComponentType>();
    }
  }, [document.dependencies, document.sequence]);
  const catalogInput = {
    origin: "all" as const,
    query: dependencyQuery,
    sort: dependencyQuery ? ("relevance" as const) : ("name" as const),
    limit: 12,
  };
  const catalogEnabled = (contentType: ActionComponentType) =>
    contentType === activeDependencyType ||
    unresolvedDependencyTypes.has(contentType);
  const particles = useParticleEffects({
    ...catalogInput,
    enabled: catalogEnabled("particle_effect"),
  });
  const sounds = useSoundEffects({
    ...catalogInput,
    enabled: catalogEnabled("sound_effect"),
  });
  const avatars = useAvatarEffectsPage({
    ...catalogInput,
    enabled: catalogEnabled("avatar_effect"),
  });
  const scenes = useSceneEffectsPage({
    ...catalogInput,
    enabled: catalogEnabled("scene_effect"),
  });
  const initialComponentItem = useActionComponent(
    initialComponentType ?? null,
    initialComponent ?? null,
  );
  const particleRows = useMemo(
    () => componentRows(particles.data),
    [particles.data],
  );
  const soundRows = useMemo(() => componentRows(sounds.data), [sounds.data]);
  const avatarRows = useMemo(() => componentRows(avatars.data), [avatars.data]);
  const sceneRows = useMemo(() => componentRows(scenes.data), [scenes.data]);

  /** Reconstruct one owned editable catalog item without route remounting. */
  const hydrateOwnedAction = useCallback(
    async (item: PyGesture | PyReaction, discardCurrentRecovery: boolean) => {
      clearSaveFailure();
      try {
        if (item.origin !== "owned" || item.state !== "ready") {
          throw new Error("This saved action is not available.");
        }
        if (!item.source)
          throw new Error("This saved action has no catalog source.");
        const preview = await actions.starterPreview.mutateAsync({
          source: item.source,
        });
        const next = await actionDocumentFromPreview({
          intent,
          item,
          preview,
          base: createDocument(),
        });
        const target = actionPreviewTarget(preview, next.name);
        if (target.sourceType !== "resolved_action") {
          throw new Error("The saved action preview was incomplete.");
        }
        finalized.current = false;
        setActiveItemId(item.item_id);
        setIdentity(null);
        setUploadedRootFile(null);
        setVrma(null);
        setPreviewRuntime(creatorActionPreviewRuntime(target.runtime));
        setRootPreviewDependencyDigest(JSON.stringify(next.dependencies));
        replaceLoadedDocument(next, true);
        setMode(
          next.implementation === "vrma" ? "vrma" : capabilities.defaultMode,
        );
        if (discardCurrentRecovery && userId) {
          clearActionRecovery(
            window.localStorage,
            userId,
            intent,
            itemId ?? null,
          );
        }
      } catch (cause) {
        setFailureMessage(
          cause instanceof Error
            ? cause.message
            : "This content could not be reopened.",
        );
        throw cause;
      }
    },
    [
      actions.starterPreview,
      capabilities.defaultMode,
      clearSaveFailure,
      createDocument,
      intent,
      itemId,
      replaceLoadedDocument,
      setFailureMessage,
      userId,
    ],
  );
  const loadOwned = useCallback(
    async (item: PyGesture | PyReaction) => {
      await hydrateOwnedAction(item, true);
      // The Load dialog already reviewed discarding the previous document.
      // Keep the generic dirty-route blocker from canceling this canonical URL
      // synchronization before React commits the newly hydrated clean digest.
      internalNavigation.current = true;
      try {
        await navigate({
          to:
            intent === "gesture"
              ? "/a/gestures/$gestureId/edit"
              : "/a/reactions/$reactionId/edit",
          params:
            intent === "gesture"
              ? { gestureId: item.item_id }
              : { reactionId: item.item_id },
          replace: true,
        });
      } finally {
        internalNavigation.current = false;
      }
    },
    [hydrateOwnedAction, intent, navigate],
  );

  useEffect(() => {
    if (!userId || hydrated.current || hydrating.current) return;
    const routeItemId = itemId ?? null;
    const recovery = loadActionRecoveryForEditorRoute(
      window.localStorage,
      userId,
      intent,
      routeItemId,
    );
    if (!recovery) {
      // `/new` is already initialized from createDocument(). Mark it hydrated
      // so no later recovery/query effect can replace that blank document.
      if (routeItemId === null) {
        hydrated.current = true;
        setHydrationReady(true);
      }
      return;
    }
    hydrating.current = true;
    setRootPreviewDependencyDigest(null);
    setPreviewRuntime(null);
    replaceLoadedDocument(recovery.document);
    if (recovery.itemId !== itemId) setActiveItemId(null);
    if (
      recovery.itemId &&
      recovery.sessionId &&
      recovery.sessionRevision !== null
    ) {
      setIdentity({
        itemId: recovery.itemId,
        itemRevision: recovery.itemRevision,
        sessionId: recovery.sessionId,
        sessionRevision: recovery.sessionRevision,
      });
    }
    hydrated.current = true;
    hydrating.current = false;
    setHydrationReady(true);
  }, [intent, itemId, replaceLoadedDocument, userId]);

  useEffect(() => {
    if (hydrated.current || hydrating.current) return;
    const item = existing.data;
    if (!item || item.state !== "ready") return;
    hydrating.current = true;
    void hydrateOwnedAction(item, false)
      .then(() => {
        hydrated.current = true;
        setHydrationReady(true);
      })
      .catch(() => undefined)
      .finally(() => {
        hydrating.current = false;
      });
  }, [existing.data, hydrateOwnedAction]);

  /** Hydrate one immutable Starter Anima Pose Clip as a new private document. */
  const loadStarter = useCallback(
    async (item: PyGesture | PyReaction) => {
      clearSaveFailure();
      try {
        if (!isCustomizableStarterAction(item, intent) || !item.source) {
          throw new Error("Only Starter Anima Pose Clips can be customized.");
        }
        const preview = await actions.starterPreview.mutateAsync({
          source: item.source,
        });
        const next = await actionDocumentFromPreview({
          intent,
          item,
          preview,
          base: createDocument(),
          customizeStarter: true,
          semanticSuffix: crypto.randomUUID(),
        });
        const target = actionPreviewTarget(preview, next.name);
        if (target.sourceType !== "resolved_action") {
          throw new Error("The Starter action preview was incomplete.");
        }
        finalized.current = false;
        setActiveItemId(null);
        setIdentity(null);
        setUploadedRootFile(null);
        setVrma(null);
        setPreviewRuntime(creatorActionPreviewRuntime(target.runtime));
        setRootPreviewDependencyDigest(JSON.stringify(next.dependencies));
        cleanDigest.current = "__starter_template__";
        replaceLoadedDocument(next);
        setMode(capabilities.defaultMode);
        if (userId) {
          clearActionRecovery(
            window.localStorage,
            userId,
            intent,
            itemId ?? null,
          );
        }
      } catch (cause) {
        setFailureMessage(
          cause instanceof Error
            ? cause.message
            : "This Starter content could not be loaded.",
        );
        throw cause;
      }
    },
    [
      actions.starterPreview,
      capabilities.defaultMode,
      clearSaveFailure,
      createDocument,
      intent,
      itemId,
      replaceLoadedDocument,
      setFailureMessage,
      userId,
    ],
  );

  useEffect(() => {
    // Recovery belongs to exact edit routes. `/new` intentionally stays blank
    // across navigation and refresh instead of reviving a prior action.
    if (!userId || finalized.current || itemId === undefined || !hydrationReady)
      return;
    if (!dirty) {
      clearActionRecovery(window.localStorage, userId, intent, itemId);
      return;
    }
    const timer = window.setTimeout(() => {
      saveActionRecovery(
        window.localStorage,
        {
          userId,
          itemId: identity?.itemId ?? activeItemId,
          itemRevision:
            identity?.itemRevision ??
            (activeItemId === itemId ? existing.data?.revision_sha256 : null) ??
            null,
          sessionId: identity?.sessionId ?? null,
          sessionRevision: identity?.sessionRevision ?? null,
          document,
          rootDigest: actionDocumentDigest(document),
        },
        itemId ?? null,
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    activeItemId,
    document,
    dirty,
    existing.data?.revision_sha256,
    hydrationReady,
    identity,
    intent,
    itemId,
    userId,
  ]);

  useEffect(() => {
    if (document.implementation === "vrma") setMode("vrma");
    else if (mode === "vrma") setMode(capabilities.defaultMode);
  }, [capabilities.defaultMode, document.implementation, mode]);

  /** Capture the live timeline before any preview or catalog Save. */
  const capturePersistenceDocument = useCallback(() => {
    const next = actionDocumentForPersistence(
      documentRef.current,
      usePoseCreatorStore.getState().clipDraft,
    );
    documentRef.current = next;
    historyRef.current.commit(actionAuthoringSnapshot(next));
    return next;
  }, []);

  const ensureSession = async (currentDocument: ActionDocument) => {
    const operationId = crypto.randomUUID();
    if (!identity) {
      const created = await actions.beginSession.mutateAsync({
        document: currentDocument,
        operationId,
        itemId: activeItemId ?? undefined,
      });
      setIdentity(created);
      return created;
    }
    const updated = await actions.updateSession.mutateAsync({
      identity,
      document: currentDocument,
    });
    setIdentity(updated);
    return updated;
  };

  /** Save once and return the exact typed target used by Save & Equip. */
  const saveAction = async (): Promise<ManageActionTarget> => {
    clearSaveFailure();
    try {
      const currentDocument = capturePersistenceDocument();
      const currentIssues = validateActionDocument(currentDocument);
      if (currentIssues.length) {
        setValidationAttempted(true);
        const description = currentIssues
          .map((issue) => issue.message)
          .join(" ");
        toast.error(
          `Complete the required ${intent === "gesture" ? "Gesture" : "Reaction"} details.`,
          {
            description,
          },
        );
        throw new Error(description);
      }
      setSaveStage("preparing");
      const session = await ensureSession(currentDocument);
      const file =
        currentDocument.implementation === "vrma"
          ? vrma
          : new File(
              [JSON.stringify(currentDocument.sequence)],
              `${currentDocument.semanticKey || "reaction"}.json`,
              { type: "application/json" },
            );
      if (!file)
        throw contentSaveFieldError(
          "Choose a VRMA file before saving.",
          "files",
        );
      const sha256 = await sha256File(file);
      const fingerprint = contentFileFingerprint(file, sha256);
      if (
        uploadedRootFile?.sessionId !== session.sessionId ||
        uploadedRootFile.fingerprint !== fingerprint
      ) {
        setSaveStage("uploading");
        const uploaded = await actions.stageFile.mutateAsync({
          sessionId: session.sessionId,
          file,
          role:
            currentDocument.implementation === "vrma"
              ? "animation"
              : "sequence",
          sha256,
        });
        setUploadedRootFile({
          sessionId: session.sessionId,
          fileRef: uploaded.file_ref,
          fingerprint,
        });
      }
      setSaveStage("saving");
      const ready = await actions.save.mutateAsync({
        identity: session,
      });
      finalized.current = true;
      cleanDigest.current = actionDocumentDigest(currentDocument);
      if (userId)
        clearActionRecovery(
          window.localStorage,
          userId,
          intent,
          itemId ?? null,
        );
      setIdentity(null);
      setUploadedRootFile(null);
      setSaveStage("idle");
      const label = intent === "gesture" ? "Gesture" : "Reaction";
      toast.success(`${label} saved.`, {
        description:
          "The readable Local files were updated. Active chats keep their mounted bytes until reopened.",
      });
      return {
        kind: intent,
        itemId: ready.item_id,
        name: currentDocument.name.trim(),
        description:
          currentDocument.description.trim() ||
          currentDocument.aiDescription.trim(),
        source: {
          type: "catalog",
          catalog_item_id: ready.item_id,
          logical_key:
            ready.logical_key ??
            `local:${intent}:${currentDocument.semanticKey || ready.item_id}`,
        },
        semanticKey: currentDocument.semanticKey,
        ...(intent === "reaction"
          ? {
              emotion: currentDocument.suggestedEmotion,
              intensity: currentDocument.suggestedIntensity,
            }
          : {}),
        includedCount: currentDocument.dependencies.length,
      };
    } catch (cause) {
      setSaveStage("idle");
      const error = captureSaveFailure(cause);
      throw error;
    }
  };

  const navigateToAction = async (targetItemId: string) => {
    await navigate({
      to:
        intent === "gesture"
          ? "/a/gestures/$gestureId/edit"
          : "/a/reactions/$reactionId/edit",
      params:
        intent === "gesture"
          ? { gestureId: targetItemId }
          : { reactionId: targetItemId },
      replace: true,
    });
  };

  const save = async () => {
    try {
      const target = await saveAction();
      await navigateToAction(target.itemId);
    } catch {
      // saveAction owns the visible recoverable error.
    }
  };

  const saveAndEquip = async () => {
    try {
      setManageTarget(await saveAction());
    } catch {
      // saveAction owns the visible recoverable error.
    }
  };

  const commitAuthoring = useCallback((next: ActionDocument) => {
    historyRef.current.commit(
      actionAuthoringSnapshot(normalizeActionDocument(next)),
    );
  }, []);
  const addComponent = useCallback(
    (
      item: PyCatalogViewItem,
      contentType: ActionComponentType,
      options?: { timeSec?: number },
    ) => {
      if (!item.source) return;
      const next = addActionComponentEvent(documentRef.current, {
        name: item.name,
        contentType,
        source: item.source,
        time:
          options?.timeSec ??
          usePoseCreatorStore.getState().clipDraft.currentTimeSec,
      });
      commitAuthoring(canonicalizeActionComponentInsertion(next));
      // Read the appended ID before canonicalization sorts events by time.
      // The caller can select the exact dropped event after timeline hydration.
      const event = Array.isArray(next.sequence.events)
        ? next.sequence.events.at(-1)
        : undefined;
      return event && typeof event.id === "string" ? event.id : undefined;
    },
    [commitAuthoring],
  );
  const removeDependency = useCallback(
    (alias: string) =>
      commitAuthoring(removeActionDependency(documentRef.current, alias)),
    [commitAuthoring],
  );
  const mapDependency = useCallback(
    (
      alias: string,
      item: PyCatalogViewItem,
      contentType: ActionComponentType,
    ) => {
      if (!item.source) return;
      commitAuthoring(
        mapActionDependency(documentRef.current, {
          alias,
          contentType,
          source: item.source,
        }),
      );
    },
    [commitAuthoring],
  );
  const applyImport = useCallback(
    (value: ActionImport) => {
      const current = documentRef.current;
      const next: ActionDocument = normalizeActionDocument(
        value.kind === "project"
          ? {
              ...current,
              name: value.project.name,
              description: value.project.description,
              aiDescription: value.project.aiDescription,
              semanticKey: value.project.semanticKey,
              suggestedEmotion: value.project.suggestedEmotion,
              suggestedIntensity: value.project.suggestedIntensity,
              notes: value.project.notes,
              implementation: "anima_clip",
              sequence: value.project.sequence as unknown as Record<
                string,
                unknown
              >,
              dependencies: value.project.dependencies,
            }
          : {
              ...renameActionDocument(
                current,
                current.name.trim() || value.sequence.name.trim(),
                !identity,
              ),
              implementation: "anima_clip",
              sequence: value.sequence as unknown as Record<string, unknown>,
              dependencies: current.dependencies.filter((dependency) =>
                new Set(
                  referencedAliases(
                    value.sequence as unknown as Record<string, unknown>,
                  ),
                ).has(dependency.alias),
              ),
            },
      );
      if (intent === "reaction" && hasHumanoidTracks(next.sequence)) {
        throw new Error(
          "Reactions cannot import humanoid pose or bone tracks.",
        );
      }
      setVrma(null);
      setValidationAttempted(false);
      setMode(capabilities.defaultMode);
      setDocument((documentState) => ({
        ...documentState,
        name: next.name,
        description: next.description,
        aiDescription: next.aiDescription,
        semanticKey: next.semanticKey,
        implementation: next.implementation,
        suggestedEmotion: next.suggestedEmotion,
        suggestedIntensity: next.suggestedIntensity,
        notes: next.notes,
      }));
      historyRef.current.commit(actionAuthoringSnapshot(next));
      setTimelineSession((value) => value + 1);
    },
    [capabilities.defaultMode, identity, intent],
  );
  const startNew = useCallback(async () => {
    const next = createDocument();
    finalized.current = false;
    setActiveItemId(null);
    setIdentity(null);
    setUploadedRootFile(null);
    setVrma(null);
    clearSaveFailure();
    setPreviewRuntime(null);
    setRootPreviewDependencyDigest(null);
    replaceLoadedDocument(next, true);
    setMode(capabilities.defaultMode);
    if (userId) {
      clearActionRecoveryForNewDocument(
        window.localStorage,
        userId,
        intent,
        itemId ?? null,
      );
    }
    // New is an explicit, already-reviewed workspace transition. Keep stale
    // dirty state from blocking the route update before React commits reset.
    internalNavigation.current = true;
    try {
      await navigate({
        to: intent === "gesture" ? "/a/gestures/new" : "/a/reactions/new",
        search: {},
      });
    } finally {
      internalNavigation.current = false;
    }
  }, [
    capabilities.defaultMode,
    clearSaveFailure,
    createDocument,
    intent,
    itemId,
    navigate,
    replaceLoadedDocument,
    userId,
  ]);

  useEffect(() => {
    if (!initialComponent || initialComponentApplied.current) return;
    if (initialComponentItem.data && initialComponentType) {
      initialComponentApplied.current = true;
      const sourceKey = exactSourceKey(initialComponentItem.data.source);
      const exists = documentRef.current.dependencies.some(
        (dependency) =>
          dependency.content_type === initialComponentType &&
          exactSourceKey(dependency.source) === sourceKey,
      );
      if (!exists)
        addComponent(initialComponentItem.data, initialComponentType);
      return;
    }
    if (initialComponentType && initialComponentItem.isPending) return;
    const rows = [
      ...particleRows.map((item) => [item, "particle_effect"] as const),
      ...soundRows.map((item) => [item, "sound_effect"] as const),
      ...avatarRows.map((item) => [item, "avatar_effect"] as const),
      ...sceneRows.map((item) => [item, "scene_effect"] as const),
    ];
    const found = rows.find(([item]) => item.item_id === initialComponent);
    if (!found) return;
    initialComponentApplied.current = true;
    addComponent(found[0], found[1]);
  }, [
    addComponent,
    avatarRows,
    initialComponent,
    initialComponentItem.data,
    initialComponentItem.isPending,
    initialComponentType,
    particleRows,
    sceneRows,
    soundRows,
  ]);

  const dependencySections = useMemo<ActionDependencySection[]>(
    () => [
      {
        label: "Particle Effects",
        contentType: "particle_effect",
        items: particleRows,
        isPending: particles.isPending,
        errorMessage: queryErrorMessage(particles.error),
        hasNextPage: Boolean(particles.hasNextPage),
        isFetchingNextPage: particles.isFetchingNextPage,
        fetchNextPage: particles.fetchNextPage,
        retry: particles.refetch,
      },
      {
        label: "Sound Effects",
        contentType: "sound_effect",
        items: soundRows,
        isPending: sounds.isPending,
        errorMessage: queryErrorMessage(sounds.error),
        hasNextPage: Boolean(sounds.hasNextPage),
        isFetchingNextPage: sounds.isFetchingNextPage,
        fetchNextPage: sounds.fetchNextPage,
        retry: sounds.refetch,
      },
      {
        label: "Avatar Effects",
        contentType: "avatar_effect",
        items: avatarRows,
        isPending: avatars.isPending,
        errorMessage: queryErrorMessage(avatars.error),
        hasNextPage: Boolean(avatars.hasNextPage),
        isFetchingNextPage: avatars.isFetchingNextPage,
        fetchNextPage: avatars.fetchNextPage,
        retry: avatars.refetch,
      },
      {
        label: "Scene Effects",
        contentType: "scene_effect",
        items: sceneRows,
        isPending: scenes.isPending,
        errorMessage: queryErrorMessage(scenes.error),
        hasNextPage: Boolean(scenes.hasNextPage),
        isFetchingNextPage: scenes.isFetchingNextPage,
        fetchNextPage: scenes.fetchNextPage,
        retry: scenes.refetch,
      },
    ],
    [
      avatarRows,
      avatars.fetchNextPage,
      avatars.hasNextPage,
      avatars.isFetchingNextPage,
      avatars.isPending,
      avatars.error,
      avatars.refetch,
      particleRows,
      particles.fetchNextPage,
      particles.hasNextPage,
      particles.isFetchingNextPage,
      particles.isPending,
      particles.error,
      particles.refetch,
      sceneRows,
      scenes.fetchNextPage,
      scenes.hasNextPage,
      scenes.isFetchingNextPage,
      scenes.isPending,
      scenes.error,
      scenes.refetch,
      soundRows,
      sounds.fetchNextPage,
      sounds.hasNextPage,
      sounds.isFetchingNextPage,
      sounds.isPending,
      sounds.error,
      sounds.refetch,
    ],
  );

  const workspaceValue = {
    document,
    setDocument,
    history,
    mode,
    setMode,
    busy,
    dirty,
    saveStage,
    issues,
    validationAttempted,
    error,
    errorField,
    clearSaveErrorField,
    itemId: activeItemId ?? undefined,
    identityExists: Boolean(identity),
    timelineSession,
    dependencyQuery,
    setDependencyQuery,
    activeDependencyType,
    setActiveDependencyType,
    dependencySections,
    addComponent,
    removeDependency,
    mapDependency,
    loadStarter,
    loadOwned,
    applyImport,
    startNew,
    vrma,
    setVrma,
    localPreviewPending: componentPreviews.pending,
    save,
    saveAndEquip,
  };

  return (
    <>
      <ContentPreviewExclusiveCanvasGate ownerId={`action-editor:${intent}`}>
        <ActionEditorPreviewProvider
          runtimeOverlay={previewRuntime}
          sandboxEntries={sandboxEntries}
        >
          <ActionEditorWorkspaceProvider value={workspaceValue}>
            <ActionEditorWorkspace />
          </ActionEditorWorkspaceProvider>
        </ActionEditorPreviewProvider>
      </ContentPreviewExclusiveCanvasGate>
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {busy
                ? "Leave while content is being saved?"
                : "Discard authoring changes?"}
            </DialogTitle>
            <DialogDescription>
              {busy
                ? "Leaving now pauses the active operation. The typed recovery document remains available when you return."
                : "This Gesture or Reaction has local authoring changes. Leaving will discard them from the active workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Stay
            </Button>
            <Button onClick={() => blocker.proceed?.()}>
              Discard and continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ActionManageDialog
        open={Boolean(manageTarget)}
        onOpenChange={(open) => {
          if (open || !manageTarget) return;
          const targetItemId = manageTarget.itemId;
          setManageTarget(null);
          void navigateToAction(targetItemId);
        }}
        target={manageTarget}
      />
    </>
  );
}
