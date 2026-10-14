"use client";

import { useNavigate, type NavigateOptions } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useProductApiClient } from "@animama/product-ui";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useContentEditorSaveSource } from "@/hooks/useContentEditorSaveSource";
import { useContentSaveFailure } from "@/hooks/useContentSaveFailure";
import {
  saveCatalogItem,
  type CatalogSaveInput,
} from "@/lib/content/catalogApi";
import type {
  PyCatalogViewItem,
  PyContentItem,
} from "@/lib/content/catalogTypes";
import type { contentEditorSaveTarget } from "@/lib/content/contentEditorSource";
import { ContentRecoveryLifecycle } from "@/lib/content/contentRecoveryLifecycle";
import type {
  CreatorRecoveryIdentity,
  CreatorRecoveryStore,
} from "@/lib/content/creatorRecoveryStore";

export type CreatorSaveKind =
  | "avatar_effect"
  | "particle_effect"
  | "scene_effect";

export type CreatorSaveStage =
  | "idle"
  | "preparing"
  | "hashing"
  | "uploading"
  | "validating"
  | "error";

const BUSY_STAGES: ReadonlySet<CreatorSaveStage> = new Set([
  "preparing",
  "hashing",
  "uploading",
  "validating",
]);

/**
 * One Save attempt's server identity. Retries reuse the operation ID (and the
 * name already resolved for it) so a request that reached the server is not
 * applied twice.
 */
export type CreatorSaveSession = {
  operationId: string;
  resolvedName?: string;
  contentFingerprint: string;
};

export type CreatorSaveTarget = ReturnType<typeof contentEditorSaveTarget>;

/** Files and descriptor for `saveCatalogItem`, built from the named snapshot. */
export type CreatorSavePayload<TSnapshot> = {
  files: File[];
  companionPaths: string[];
  descriptor: Record<string, unknown>;
  /** The snapshot the creator shows after Save (for example a normalized draft). */
  savedSnapshot: TSnapshot;
  /** Adjustments Save made that the user reviews before saving again. */
  notices?: readonly string[];
};

/**
 * What one effect kind contributes to the shared Save, undo and recovery flow.
 * Adapters are module constants so the hook's callbacks stay stable.
 */
export type CreatorSaveAdapter<
  TSnapshot,
  TRecord extends CreatorRecoveryIdentity,
> = {
  kind: CreatorSaveKind;
  /** Base for a unique name when the document has none, e.g. "New Avatar FX". */
  defaultName: string;
  savedMessage: string;
  /** Shown when Save is interrupted; the next attempt reuses the draft. */
  pausedMessage: string;
  store: CreatorRecoveryStore<TRecord>;
  fingerprint: (snapshot: TSnapshot) => string;
  name: (snapshot: TSnapshot) => string;
  withName: (snapshot: TSnapshot, name: string) => TSnapshot;
  /** Reject a name before any work starts. */
  validateName?: (name: string) => { message: string; field: string } | null;
  buildPayload: (args: {
    snapshot: TSnapshot;
    name: string;
    target: CreatorSaveTarget;
    signal: AbortSignal;
    progress: (stage: CreatorSaveStage, percent?: number) => void;
  }) => Promise<CreatorSavePayload<TSnapshot>>;
  toRecovery: (args: {
    userId: string;
    documentKey: string;
    itemId: string | undefined;
    session: CreatorSaveSession;
    snapshot: TSnapshot;
    updatedAt: string;
  }) => TRecord;
  /**
   * Throwing discards the unusable record; a {@link CreatorRecoveryDroppedError}
   * also shows its message as the recovery notice.
   */
  fromRecovery: (record: TRecord) => {
    snapshot: TSnapshot;
    operationId: string;
    contentFingerprint?: string;
    warning?: string | null;
  };
  editRoute: (itemId: string) => NavigateOptions;
};

/**
 * A stored draft the creator can no longer open (for example an older editor
 * format). The draft is discarded and the message tells the user so.
 */
export class CreatorRecoveryDroppedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorRecoveryDroppedError";
  }
}

export function createCreatorSaveSession(
  contentFingerprint: string,
): CreatorSaveSession {
  return { operationId: crypto.randomUUID(), contentFingerprint };
}

/** An interrupted Save pauses rather than failing; Retry continues it. */
export function isCreatorSavePause(caught: unknown): boolean {
  return caught instanceof DOMException && caught.name === "AbortError";
}

export type CreatorSaveRunResult<TSnapshot> =
  | { status: "review"; notices: readonly string[] }
  | {
      status: "saved";
      item: PyContentItem;
      savedSnapshot: TSnapshot;
      notices: readonly string[];
    };

/**
 * The Save pipeline without React state, so it can be tested directly:
 * name → payload → optional notice review → recovery write → catalog Save →
 * recovery clear → caller update → `replace` navigation past the leave guard.
 * Failures propagate; the session keeps its operation ID for a retry.
 */
export async function runCreatorSave<
  TSnapshot,
  TRecord extends CreatorRecoveryIdentity,
>(args: {
  adapter: CreatorSaveAdapter<TSnapshot, TRecord>;
  snapshot: TSnapshot;
  session: CreatorSaveSession;
  signal: AbortSignal;
  /** Whether the user already reviewed notices for this exact content. */
  noticesAcknowledged: boolean;
  resolveName: (name: string, fallback: string) => Promise<string>;
  saveTarget: (name: string) => CreatorSaveTarget;
  progress: (stage: CreatorSaveStage, percent?: number) => void;
  persist: (session: CreatorSaveSession, snapshot: TSnapshot) => Promise<void>;
  /** The admitted composition's catalog Save. */
  save: (input: CatalogSaveInput) => Promise<PyContentItem>;
  clearRecovery: () => Promise<void>;
  onSaved: (snapshot: TSnapshot, item: PyContentItem) => Promise<void>;
  navigate: (options: NavigateOptions) => Promise<void>;
}): Promise<CreatorSaveRunResult<TSnapshot>> {
  const { adapter, session } = args;
  const rawName = adapter.name(args.snapshot).trim();
  const name =
    rawName ||
    session.resolvedName ||
    (await args.resolveName(rawName, adapter.defaultName));
  session.resolvedName = name;
  const named = adapter.withName(args.snapshot, name);
  const target = args.saveTarget(name);
  const payload = await adapter.buildPayload({
    snapshot: named,
    name,
    target,
    signal: args.signal,
    progress: args.progress,
  });
  const notices = payload.notices ?? [];
  if (notices.length > 0 && !args.noticesAcknowledged)
    return { status: "review", notices };
  await args.persist(session, named);
  args.signal.throwIfAborted();
  args.progress("validating");
  const item = await args.save({
    kind: adapter.kind,
    entryName: name,
    files: payload.files,
    companionPaths: payload.companionPaths,
    descriptor: payload.descriptor,
    operationId: session.operationId,
    catalogItemId: target.catalogItemId,
    expectedRevision: target.expectedRevision,
  });
  args.progress("validating", 100);
  await args.clearRecovery();
  await args.onSaved(payload.savedSnapshot, item);
  toast.success(adapter.savedMessage);
  await args.navigate({
    ...adapter.editRoute(item.item_id),
    replace: true,
    ignoreBlocker: true,
  });
  return {
    status: "saved",
    item,
    savedSnapshot: payload.savedSnapshot,
    notices,
  };
}

/**
 * Shared Save, autosave recovery and discard for the effect creators.
 *
 * - Recovery restores once per document key, then autosaves 350 ms after each
 *   change while the document differs from its clean baseline (`dirty`). A
 *   clean document clears its stored draft, so reopening saved content does
 *   not resurrect a copy of it, unless the draft holds an unresolved Save
 *   operation (restored, or from a failed Save).
 * - `recoveryKey` defaults to the item ID or `new`; a `/new` route that seeds
 *   a different starting point can pass its own key.
 */
export function useCreatorSave<
  TSnapshot,
  TRecord extends CreatorRecoveryIdentity,
>({
  adapter,
  itemId,
  existing,
  recoveryKey,
  snapshot,
  dirty,
  initialized,
  ready,
  onRestore,
  onSaved,
}: {
  adapter: CreatorSaveAdapter<TSnapshot, TRecord>;
  itemId?: string;
  /** The edited catalog item; Save waits for it on edit routes. */
  existing: PyCatalogViewItem | undefined;
  recoveryKey?: string;
  snapshot: TSnapshot;
  /** The document differs from what was loaded or last saved. */
  dirty: boolean;
  /** The document is loaded and may be written to recovery. */
  initialized: boolean;
  /** The document is valid and its resources are settled. */
  ready: boolean;
  /** Install a restored draft. A new identity does not restore it again. */
  onRestore: (snapshot: TSnapshot) => void;
  onSaved: (snapshot: TSnapshot, savedItemId: string) => void;
}) {
  const userId = useRuntimeCacheKey();
  const apiClient = useProductApiClient();
  const {
    target: saveTarget,
    saved: recordSaved,
    resolveName,
  } = useContentEditorSaveSource(adapter.kind, itemId, existing);
  const navigate = useNavigate();
  const documentKey = recoveryKey ?? itemId ?? "new";
  const { store } = adapter;
  const fingerprint = useMemo(
    () => adapter.fingerprint(snapshot),
    [adapter, snapshot],
  );
  const [stage, setStage] = useState<CreatorSaveStage>("idle");
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
  const [notices, setNotices] = useState<readonly string[]>([]);
  const [noticeConfirmationRequired, setNoticeConfirmationRequired] =
    useState(false);
  const sessionRef = useRef<CreatorSaveSession | null>(null);
  /**
   * A restored draft or a failed Save holds an operation the server may have
   * applied. Its record is kept, even for an unchanged document, until a Save
   * succeeds or the user discards it, so a retry after reload reuses its ID.
   */
  const pendingOperationRef = useRef(false);
  const acknowledgedNoticeFingerprintRef = useRef<string | null>(null);
  const recoveryLifecycle = useMemo(
    () => new ContentRecoveryLifecycle(),
    // Each recovery key owns an independent queue, including owner changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentKey, userId],
  );
  const pendingResetFingerprintRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const busy = BUSY_STAGES.has(stage);

  useEffect(() => () => controllerRef.current?.abort(), []);

  // Read the latest callback: a new identity, such as one a UI Locale change
  // gives, must not load and restore the draft again.
  const restore = useEffectEvent((snapshot: TSnapshot) => onRestore(snapshot));

  useEffect(() => {
    if (!userId) return;
    // Let the replacement effect run after React Strict Mode cancels its first
    // setup pass; a persistent "already restored" ref would strand Save.
    let cancelled = false;
    const generation = recoveryLifecycle.capture();
    void store.load(userId, documentKey).then((record) => {
      if (cancelled || !recoveryLifecycle.isCurrent(generation)) return;
      if (record) {
        try {
          const restored = adapter.fromRecovery(record);
          sessionRef.current = {
            operationId: restored.operationId,
            contentFingerprint:
              restored.contentFingerprint ??
              adapter.fingerprint(restored.snapshot),
          };
          pendingOperationRef.current = true;
          restore(restored.snapshot);
          setRecovered(true);
          if (restored.warning) setRecoveryWarning(restored.warning);
        } catch (error) {
          if (error instanceof CreatorRecoveryDroppedError)
            setRecoveryWarning(error.message);
          void store.clear(userId, documentKey);
        }
      }
      setRecoveryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, documentKey, recoveryLifecycle, store, userId]);

  const persist = useCallback(
    async (
      session: CreatorSaveSession,
      savedSnapshot = adapter.withName(
        snapshot,
        adapter.name(snapshot).trim() ||
          session.resolvedName ||
          adapter.name(snapshot),
      ),
    ) => {
      if (!userId) return;
      const generation = recoveryLifecycle.capture();
      if (!recoveryLifecycle.isCurrent(generation)) return;
      const record = adapter.toRecovery({
        userId,
        documentKey,
        itemId,
        session,
        snapshot: savedSnapshot,
        updatedAt: new Date().toISOString(),
      });
      const result = await recoveryLifecycle.write(generation, () =>
        store.save(record),
      );
      if (result && recoveryLifecycle.isCurrent(generation))
        setRecoveryWarning(result.warning);
    },
    [adapter, documentKey, itemId, recoveryLifecycle, snapshot, store, userId],
  );

  // Autosave: keep a dirty document's draft current and clear a clean one's.
  // While a Save operation is unresolved the draft is rewritten even when the
  // document is clean, so it keeps the operation ID without stale content.
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
      if (!dirty && !pendingOperationRef.current) {
        void recoveryLifecycle.write(generation, () =>
          store.clear(userId, documentKey),
        );
        return;
      }
      const session =
        sessionRef.current ?? createCreatorSaveSession(fingerprint);
      session.contentFingerprint = fingerprint;
      sessionRef.current = session;
      void persist(session);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [
    busy,
    dirty,
    documentKey,
    fingerprint,
    initialized,
    persist,
    recoveryLifecycle,
    recoveryReady,
    store,
    userId,
  ]);

  const canSave = Boolean(
    userId && recoveryReady && ready && (!itemId || existing) && !busy,
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!recoveryLifecycle.isCurrent(recoveryLifecycle.capture())) return false;
    if (!userId || !canSave) return false;
    const invalidName = adapter.validateName?.(adapter.name(snapshot).trim());
    if (invalidName) {
      setStage("error");
      setSaveFailureMessage(invalidName.message, invalidName.field);
      return false;
    }
    setStage("preparing");
    clearSaveFailure();
    setUploadProgress(0);
    setNotices([]);
    setNoticeConfirmationRequired(false);
    const session = sessionRef.current ?? createCreatorSaveSession(fingerprint);
    session.contentFingerprint = fingerprint;
    sessionRef.current = session;
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await runCreatorSave({
        adapter,
        snapshot,
        session,
        signal: controller.signal,
        noticesAcknowledged:
          acknowledgedNoticeFingerprintRef.current === fingerprint,
        resolveName,
        saveTarget,
        progress: (nextStage, percent) => {
          setStage(nextStage);
          if (percent !== undefined) setUploadProgress(percent);
        },
        persist,
        save: (input) => saveCatalogItem(apiClient, input),
        clearRecovery: async () => {
          await recoveryLifecycle.discard(() =>
            store.clear(userId, documentKey),
          );
          recoveryLifecycle.resume();
        },
        onSaved: async (savedSnapshot, item) => {
          sessionRef.current = null;
          pendingOperationRef.current = false;
          setRecovered(false);
          setRecoveryWarning(null);
          onSaved(savedSnapshot, item.item_id);
          await recordSaved(item);
          setStage("idle");
        },
        navigate: (options) => navigate(options),
      });
      setNotices(result.notices);
      if (result.status === "review") {
        acknowledgedNoticeFingerprintRef.current = fingerprint;
        setNoticeConfirmationRequired(true);
        setStage("idle");
        return false;
      }
      return true;
    } catch (caught) {
      if (isCreatorSavePause(caught)) {
        setSaveFailureMessage(adapter.pausedMessage);
      } else {
        captureSaveFailure(caught);
      }
      pendingOperationRef.current = true;
      setStage("error");
      setRecovered(true);
      return false;
    } finally {
      controllerRef.current = null;
    }
  }, [
    apiClient,
    adapter,
    canSave,
    captureSaveFailure,
    clearSaveFailure,
    documentKey,
    fingerprint,
    navigate,
    onSaved,
    persist,
    recordSaved,
    recoveryLifecycle,
    resolveName,
    saveTarget,
    setSaveFailureMessage,
    snapshot,
    store,
    userId,
  ]);

  /** Drop the preserved server draft: a new operation ID, same document. */
  const discardRecovery = useCallback(async () => {
    if (!userId || busy) return;
    await recoveryLifecycle.discard(() => store.clear(userId, documentKey));
    recoveryLifecycle.resume();
    sessionRef.current = createCreatorSaveSession(fingerprint);
    pendingOperationRef.current = false;
    clearSaveFailure();
    setRecovered(false);
    setRecoveryWarning(null);
    setStage("idle");
    if (dirty) await persist(sessionRef.current);
  }, [
    busy,
    clearSaveFailure,
    dirty,
    documentKey,
    fingerprint,
    persist,
    recoveryLifecycle,
    store,
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
        store.clear(userId, documentKey, { strict: true }),
      );
    } catch (caught) {
      recoveryLifecycle.resume();
      throw caught;
    }
    sessionRef.current = null;
    pendingOperationRef.current = false;
    acknowledgedNoticeFingerprintRef.current = null;
    clearSaveFailure();
    setRecovered(false);
    setRecoveryWarning(null);
    setUploadProgress(0);
    setNotices([]);
    setNoticeConfirmationRequired(false);
    setStage("idle");
    return true;
  }, [busy, clearSaveFailure, documentKey, recoveryLifecycle, store, userId]);

  /** Start over: resume recovery only once the caller installs `next`. */
  const resetSession = useCallback(
    async (next: TSnapshot): Promise<boolean> => {
      if (!(await discardChanges())) return false;
      const nextFingerprint = adapter.fingerprint(next);
      pendingResetFingerprintRef.current = nextFingerprint;
      sessionRef.current = createCreatorSaveSession(nextFingerprint);
      setRecoveryReady(true);
      return true;
    },
    [adapter, discardChanges],
  );

  return {
    canSave,
    discardRecovery,
    discardChanges,
    error,
    errorField,
    clearSaveErrorField,
    isBusy: busy,
    notices,
    noticeConfirmationRequired,
    recovered,
    recoveryReady,
    recoveryWarning,
    resetSession,
    save,
    stage,
    uploadProgress,
  };
}
