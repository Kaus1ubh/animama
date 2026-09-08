"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { type Avatar, VRMEditorSession } from "@/lib/avatar";

type UseVRMEditorSessionArgs = {
  avatar?: Avatar | null;
  sourceUrl?: string | null;
  arrayBuffer?: ArrayBuffer | null;
  sourceKey?: string | null;
  enabled?: boolean;
};

type SessionState = {
  session: VRMEditorSession | null;
  sessionKey: string | null;
  error: string | null;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function useVRMEditorSession({
  avatar,
  sourceUrl,
  arrayBuffer,
  sourceKey,
  enabled = true,
}: UseVRMEditorSessionArgs) {
  const requestKey = useMemo(() => {
    if (!enabled || !avatar) return null;
    const resolvedSourceKey =
      sourceKey ??
      sourceUrl ??
      avatar.sourceUrl ??
      avatar.scene?.uuid ??
      "active-avatar";
    const bufferKey = arrayBuffer
      ? `buffer:${arrayBuffer.byteLength}`
      : "no-buffer";
    return `${resolvedSourceKey}:${bufferKey}`;
  }, [arrayBuffer, avatar, enabled, sourceKey, sourceUrl]);

  const [sessionState, setSessionState] = useState<SessionState>({
    session: null,
    sessionKey: null,
    error: null,
  });

  useEffect(() => {
    let isCancelled = false;
    let session: VRMEditorSession | null = null;

    if (!enabled || !avatar || !requestKey) {
      return;
    }

    void (async () => {
      try {
        session = await VRMEditorSession.create({
          avatar,
          sourceUrl,
          arrayBuffer,
          sourceKey,
        });
        if (isCancelled) {
          session.dispose();
          return;
        }
        setSessionState({
          session,
          sessionKey: requestKey,
          error: null,
        });
      } catch (error) {
        if (isCancelled) return;
        setSessionState({
          session: null,
          sessionKey: requestKey,
          error: toErrorMessage(error),
        });
      }
    })();

    return () => {
      isCancelled = true;
      session?.dispose();
    };
  }, [arrayBuffer, avatar, enabled, requestKey, sourceKey, sourceUrl]);

  const activeSession =
    sessionState.sessionKey === requestKey ? sessionState.session : null;
  const activeError =
    sessionState.sessionKey === requestKey ? sessionState.error : null;

  const fallbackSnapshot = useMemo(() => {
    const snapshot = VRMEditorSession.createEmptySnapshot();
    return {
      ...snapshot,
      status: requestKey ? (activeError ? "error" : "loading") : "idle",
      error: activeError,
    };
  }, [activeError, requestKey]);

  const subscribe = useCallback(
    (listener: () => void) =>
      activeSession ? activeSession.subscribe(listener) : () => {},
    [activeSession],
  );

  const getSnapshot = useCallback(
    () => (activeSession ? activeSession.getSnapshot() : fallbackSnapshot),
    [activeSession, fallbackSnapshot],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const refresh = useCallback(async () => {
    if (!activeSession) return;
    await activeSession.refresh();
  }, [activeSession]);

  return {
    session: activeSession,
    snapshot,
    status: snapshot.status,
    error: snapshot.error,
    refresh,
  };
}
