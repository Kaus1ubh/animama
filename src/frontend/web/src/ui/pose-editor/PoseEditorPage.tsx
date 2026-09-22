"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useIsMutating } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { usePose } from "@/query/hooks/usePoses";
import { queryKeys } from "@/query/keys";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { retainActionEditorWorkspace } from "@/ui/action-editor/actionEditorStoreLifecycle";
import { useActionEditorDesktopLayout } from "@/ui/action-editor/useActionEditorDesktopLayout";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { ContentPreviewExclusiveCanvasGate } from "@/ui/content-preview/ContentPreviewDockProvider";
import { PoseCreatorPreviewProvider } from "@/ui/pose-creator/PoseCreatorPreviewProvider";
import { PoseCreatorLibrarySection } from "@/ui/pose-creator/PoseCreatorLibrarySection";
import { PoseCreatorBoneSection } from "@/ui/pose-creator/PoseCreatorBoneSection";
import { PoseCreatorExpressionSection } from "@/ui/pose-creator/PoseCreatorExpressionSection";
import { PoseCreatorPreviewSettingsPanel } from "@/ui/pose-creator/PoseCreatorPreviewSettingsPanel";
import { PosePrimaryActions } from "@/ui/pose-creator/PosePrimaryActions";
import {
  getPoseCreatorHistoryKeyboardAction,
  isPoseCreatorNativeUndoTarget,
} from "@/ui/pose-creator/poseCreatorUndo";
import { PoseEditorSession } from "./poseEditorSession";
import { PoseEditorScene } from "./PoseEditorScene";

/** Claim store lifetime before waiting for the previous preview canvas to dispose. */
export function PoseEditorPage({ poseId }: { poseId: string }) {
  const resetWorkspace = usePoseCreatorStore((state) => state.resetWorkspace);
  useEffect(
    () => retainActionEditorWorkspace(resetWorkspace),
    [resetWorkspace],
  );
  return (
    <ContentPreviewExclusiveCanvasGate ownerId="pose-editor">
      <PoseCreatorPreviewProvider>
        <PoseEditorWorkspace poseId={poseId} />
      </PoseCreatorPreviewProvider>
    </ContentPreviewExclusiveCanvasGate>
  );
}

type PoseTool = "bones" | "expressions" | "preview";

/** Library item editing reuses Pose controls without mounting an Action document. */
export function PoseEditorWorkspace({ poseId }: { poseId: string }) {
  const [session] = useState(() => new PoseEditorSession());
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [tool, setTool] = useState<PoseTool>("bones");
  const item = usePose(poseId);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const avatarStatus = usePoseCreatorStore((state) => state.loadStatus);
  const dirty = usePoseCreatorStore((state) => state.isDirty);
  const savedIdentity = usePoseCreatorStore((state) => state.savedPoseIdentity);
  const owner = useRuntimeOwnerId();
  const busy =
    useIsMutating({ mutationKey: queryKeys.poses.save(owner ?? "__anon__") }) >
    0;
  const desktop = useActionEditorDesktopLayout();
  const navigate = useNavigate({ from: "/a/poses/$poseId/edit" });
  const canonicalNavigation = useRef<string | null>(null);

  useLayoutEffect(() => {
    session.activate(poseId);
    setLoaded(session.isLoaded(poseId));
    setLoadError(null);
    if (canonicalNavigation.current === poseId)
      canonicalNavigation.current = null;
    return () => session.cancelPending();
  }, [poseId, session]);

  const metadata = item.data;
  useEffect(() => {
    if (
      !metadata ||
      !activeAvatar ||
      avatarStatus !== "ready" ||
      session.isLoaded(poseId)
    )
      return;
    let current = true;
    setLoading(true);
    setLoadError(null);
    void session
      .load(metadata)
      .then((success) => {
        if (!current) return;
        setLoading(false);
        setLoaded(success);
        if (!success)
          setLoadError(
            "Pose could not be loaded. Your current work is preserved; retry when the content and Avatar are available.",
          );
      })
      .catch((error) => {
        if (!current) return;
        setLoading(false);
        setLoadError(
          error instanceof Error ? error.message : "Pose could not be loaded.",
        );
      });
    return () => {
      current = false;
      session.cancelPending();
    };
  }, [metadata, poseId, activeAvatar, avatarStatus, retry, session]);

  // Save/Load already supplied the active document. Canonical navigation must not
  // rehydrate it or discard edits made after an asynchronous Save began.
  useEffect(() => {
    if (!loaded || !savedIdentity || savedIdentity.itemId === poseId) return;
    const itemId = savedIdentity.itemId;
    session.adoptSavedItem(itemId);
    canonicalNavigation.current = itemId;
    void navigate({
      to: "/a/poses/$poseId/edit",
      params: { poseId: itemId },
      replace: true,
    }).catch(() => {
      canonicalNavigation.current = null;
      setLoadError(
        "The Pose was saved, but its editor address could not be updated. Open the saved item from Library.",
      );
    });
  }, [loaded, navigate, poseId, savedIdentity, session]);

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (
        canonicalNavigation.current &&
        next.pathname ===
          `/a/poses/${encodeURIComponent(canonicalNavigation.current)}/edit`
      )
        return false;
      return (dirty || busy) && current.pathname !== next.pathname;
    },
    enableBeforeUnload: () => dirty || busy,
    withResolver: true,
  });

  useEffect(() => {
    if (!loaded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = getPoseCreatorHistoryKeyboardAction(event);
      if (!action || isPoseCreatorNativeUndoTarget(event.target)) return;
      event.preventDefault();
      const state = usePoseCreatorStore.getState();
      if (action === "undo") state.undoPose();
      else state.redoPose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loaded]);

  const editable = loaded && Boolean(activeAvatar) && avatarStatus === "ready";
  const error = item.error ? "Pose could not be loaded." : loadError;
  const retryPose = async () => {
    setLoadError(null);
    await item.refetch();
    setRetry((value) => value + 1);
  };
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pose-editor">
      <header className="border-border shrink-0 border-b px-3 py-3 lg:px-4">
        <h1 className="sr-only">Pose editor</h1>
        <fieldset
          disabled={!editable}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] grid-rows-[auto_auto] items-center gap-2 lg:grid-cols-[auto_auto_auto_auto_minmax(120px,1fr)_auto] lg:grid-rows-1 lg:items-start lg:gap-1.5 2xl:gap-3"
        >
          <Button
            asChild
            variant="outline"
            className="col-start-1 row-start-1 h-11 rounded-xl lg:h-12"
          >
            <Link
              to="/a/library"
              search={{ section: "actions", action: "poses" }}
              aria-label="Back to Poses"
            >
              <ArrowLeftIcon className="size-4" />
              <span>Poses</span>
            </Link>
          </Button>
          <PoseCreatorLibrarySection variant="toolbar" hideNew />
          <PosePrimaryActions />
        </fieldset>
      </header>
      {error ? (
        <div
          className="border-destructive/40 bg-destructive/5 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2"
          role="alert"
        >
          <p className="text-sm">{error}</p>
          <Button variant="outline" onClick={() => void retryPose()}>
            Retry pose
          </Button>
        </div>
      ) : !loaded ? (
        <p
          className="text-muted-foreground shrink-0 px-4 py-2 text-sm"
          role="status"
        >
          {loading || item.isPending
            ? "Loading pose…"
            : "Choose an Avatar to edit this pose."}
        </p>
      ) : null}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        data-testid="pose-editor-workspace"
        style={{ "--app-shell-sidebar-inset": "0px" } as CSSProperties}
      >
        <div
          className={
            desktop ? "absolute inset-0" : "h-[38dvh] min-h-[230px] shrink-0"
          }
        >
          <PoseEditorScene editable={editable} />
        </div>
        {desktop ? (
          <>
            <fieldset
              disabled={!editable}
              className="pointer-events-none absolute inset-0 min-w-0"
            >
              <PoseCreatorBoneSection variant="workspace" />
              <PoseCreatorExpressionSection variant="workspace" />
            </fieldset>
            <div className="pointer-events-none absolute inset-x-2 bottom-3 flex justify-center">
              <PoseCreatorPreviewSettingsPanel />
            </div>
          </>
        ) : (
          <>
            <nav
              aria-label="Pose tools"
              className="border-border flex shrink-0 gap-1 border-y p-2"
            >
              {(["bones", "expressions", "preview"] as const).map((value) => (
                <Button
                  key={value}
                  variant={tool === value ? "secondary" : "ghost"}
                  className="min-h-11 flex-1"
                  aria-pressed={tool === value}
                  onClick={() => setTool(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </Button>
              ))}
            </nav>
            <fieldset
              disabled={!editable && tool !== "preview"}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {tool === "bones" ? (
                <PoseCreatorBoneSection variant="mobile" />
              ) : tool === "expressions" ? (
                <PoseCreatorExpressionSection variant="mobile" />
              ) : (
                <PoseCreatorPreviewSettingsPanel variant="mobile" />
              )}
            </fieldset>
          </>
        )}
      </div>
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard pose changes?</DialogTitle>
            <DialogDescription>
              {busy
                ? "A Pose save is still in progress. Leaving closes this editor; check Library for the saved result before trying again."
                : "This Pose has unsaved changes. Stay to keep editing, or discard them and continue."}
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
    </div>
  );
}
