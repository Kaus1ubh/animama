import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  ContentPreviewTarget,
  ContentPreviewView,
} from "@/lib/content-preview/types";
import {
  INITIAL_CONTENT_PREVIEW_DOCK_STATE,
  reduceContentPreviewDockState,
  shouldArmContentPreviewIdleTimer,
} from "@/lib/content-preview/state";
import { logContentPreviewLifecycle } from "@/lib/content-preview/lifecycle";

export const CONTENT_PREVIEW_WARM_IDLE_MS = 5 * 60 * 1000;

type ContentPreviewDockContextValue = {
  target: ContentPreviewTarget | null;
  view: ContentPreviewView;
  openPreview: (target: ContentPreviewTarget) => void;
  minimize: () => void;
  restore: () => void;
  toggleExpanded: () => void;
  close: () => void;
  expireSession: () => void;
  returnFocusToInvoker: () => void;
  managementOwnerId: string | null;
  claimManagementCanvas: (ownerId: string) => void;
  releaseManagementCanvas: (ownerId: string) => void;
};

const ContentPreviewDockContext =
  createContext<ContentPreviewDockContextValue | null>(null);

const LazyContentPreviewHost = lazy(() =>
  import("./ContentPreviewHost").then((module) => ({
    default: module.ContentPreviewHost,
  })),
);

export function useContentPreviewDock(): ContentPreviewDockContextValue {
  const value = useContext(ContentPreviewDockContext);
  if (!value) {
    throw new Error(
      "useContentPreviewDock must be used within ContentPreviewDockProvider",
    );
  }
  return value;
}

/** Own one route-stable preview session and its bounded warm-idle lifetime. */
export function ContentPreviewDockProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    reduceContentPreviewDockState,
    INITIAL_CONTENT_PREVIEW_DOCK_STATE,
  );
  const invokerRef = useRef<HTMLElement | null>(null);
  const { target, view, initialized, managementOwnerId } = state;

  const openPreview = useCallback((next: ContentPreviewTarget) => {
    if (document.activeElement instanceof HTMLElement) {
      invokerRef.current = document.activeElement;
    }
    dispatch({ type: "open", target: next });
  }, []);
  const returnFocusToInvoker = useCallback(() => {
    const invoker = invokerRef.current;
    if (!invoker?.isConnected) return;
    window.requestAnimationFrame(() => invoker.focus());
  }, []);
  const minimize = useCallback(() => {
    dispatch({ type: "view", event: "minimize" });
    returnFocusToInvoker();
  }, [returnFocusToInvoker]);
  const restore = useCallback(
    () => dispatch({ type: "view", event: "restore" }),
    [],
  );
  const toggleExpanded = useCallback(
    () => dispatch({ type: "view", event: "toggle_expand" }),
    [],
  );
  const close = useCallback(
    () => dispatch({ type: "view", event: "close" }),
    [],
  );
  const expireSession = useCallback(() => {
    dispatch({ type: "expire" });
  }, []);
  const claimManagementCanvas = useCallback((ownerId: string) => {
    invokerRef.current = null;
    dispatch({ type: "claim_management", ownerId });
  }, []);
  const releaseManagementCanvas = useCallback((ownerId: string) => {
    dispatch({ type: "release_management", ownerId });
  }, []);

  useEffect(() => {
    if (!shouldArmContentPreviewIdleTimer(initialized, view)) return;
    const timeout = window.setTimeout(() => {
      logContentPreviewLifecycle("eviction", "dock", { reason: "timeout" });
      expireSession();
    }, CONTENT_PREVIEW_WARM_IDLE_MS);
    return () => window.clearTimeout(timeout);
  }, [expireSession, initialized, view]);

  const value = useMemo<ContentPreviewDockContextValue>(
    () => ({
      target,
      view,
      openPreview,
      minimize,
      restore,
      returnFocusToInvoker,
      toggleExpanded,
      close,
      expireSession,
      claimManagementCanvas,
      releaseManagementCanvas,
      managementOwnerId,
    }),
    [
      close,
      claimManagementCanvas,
      expireSession,
      minimize,
      managementOwnerId,
      openPreview,
      restore,
      releaseManagementCanvas,
      returnFocusToInvoker,
      target,
      toggleExpanded,
      view,
    ],
  );

  return (
    <ContentPreviewDockContext.Provider value={value}>
      {children}
      {initialized ? (
        <Suspense fallback={null}>
          <LazyContentPreviewHost />
        </Suspense>
      ) : null}
    </ContentPreviewDockContext.Provider>
  );
}

/** Delay an exclusive route renderer until any retained Dock has unmounted. */
export function ContentPreviewExclusiveCanvasGate({
  ownerId,
  children,
}: {
  ownerId: string;
  children: ReactNode;
}) {
  const { managementOwnerId, claimManagementCanvas, releaseManagementCanvas } =
    useContentPreviewDock();
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    setReady(false);
    claimManagementCanvas(ownerId);
    return () => {
      releaseManagementCanvas(ownerId);
    };
  }, [claimManagementCanvas, ownerId, releaseManagementCanvas]);

  useEffect(() => {
    if (managementOwnerId !== ownerId) {
      setReady(false);
      return;
    }
    // Passive effects run after the removed Dock host has disposed its canvas,
    // target catalog, Blob URLs, Avatar, and focus state.
    setReady(true);
  }, [managementOwnerId, ownerId]);

  return ready && managementOwnerId === ownerId ? children : null;
}
