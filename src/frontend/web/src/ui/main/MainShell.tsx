"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useFullscreen } from "@/hooks/useFullscreen";
import { usePictureInPicture } from "@/hooks/usePictureInPicture";
import { cn } from "@/lib/utils";
import type { AppShellSidebarLayoutStyle } from "@/ui/app/appShellSidebarLayout";
import {
  CanvasControls,
  type CanvasMode,
} from "@/ui/main/canvas/CanvasControls";
import { AvatarSceneHost } from "@/ui/main/canvas/AvatarSceneHost";
import { Header } from "@/ui/main/header/Header";

type MainShellProps = {
  actions?: ReactNode;
  chatPanel?: ReactNode | ((state: { canvasMode: CanvasMode }) => ReactNode);
  /** Bottom-center content shown in the Avatar-only mode, where no chat panel is rendered. */
  avatarOnlyOverlay?: ReactNode;
  headerLeft?: ReactNode;
  headerCenter?: ReactNode;
  headerRight?: ReactNode;
  headerOnMenuClick?: () => void;
  children?: ReactNode;
  className?: string;
};

/** Keep the live Anima scene full-viewport beneath the fixed sidebar. */
const FULL_WIDTH_ANIMA_SHELL_STYLE: AppShellSidebarLayoutStyle = {
  "--app-shell-sidebar-inset": "0px",
  marginLeft: "0px",
  width: "100%",
};

export function MainShell({
  actions,
  chatPanel,
  avatarOnlyOverlay,
  headerLeft,
  headerCenter,
  headerRight,
  headerOnMenuClick,
  children,
  className,
}: MainShellProps) {
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [canvasWrapperElement, setCanvasWrapperElement] =
    useState<HTMLDivElement | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("avatar-chat");
  const {
    backgroundMode,
    canvasHostRef,
    isPipActive,
    isPipSupported,
    setBackgroundMode,
    showBackgroundModeControl,
    suspendMainScene,
    togglePip,
  } = usePictureInPicture({ canvasMode, setCanvasMode });
  const { isFullscreen, enterFullscreen, exitFullscreen } =
    useFullscreen(canvasWrapperRef);

  const handleEnterFullscreen = useCallback(() => {
    if (isPipActive) return;
    enterFullscreen();
  }, [enterFullscreen, isPipActive]);

  const handleExitFullscreen = useCallback(() => {
    exitFullscreen();
  }, [exitFullscreen]);

  const handleCanvasWrapperRef = useCallback((node: HTMLDivElement | null) => {
    canvasWrapperRef.current = node;
    setCanvasWrapperElement(node);
  }, []);

  const handleCanvasModeChange = useCallback((mode: CanvasMode) => {
    setCanvasMode(mode);
  }, []);

  const handlePictureInPicture = useCallback(() => {
    void togglePip();
  }, [togglePip]);
  const renderedChatPanel =
    typeof chatPanel === "function" ? chatPanel({ canvasMode }) : chatPanel;

  return (
    <div
      className={cn(
        "flex min-h-0 w-full min-w-0 flex-1 flex-col transition-[margin-left,width] duration-150 ease-in-out",
        className,
      )}
      style={FULL_WIDTH_ANIMA_SHELL_STYLE}
    >
      <main className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={handleCanvasWrapperRef}
          className="bg-background relative h-full w-full overflow-hidden"
        >
          <AvatarSceneHost
            backgroundMode={backgroundMode}
            canvasHostRef={canvasHostRef}
            canvasMode={canvasMode}
            canvasWrapperElement={canvasWrapperElement}
            isPipActive={isPipActive}
            mode="main"
            suspendSceneRender={suspendMainScene}
          >
            {({ cameraControls, overlayPassthroughActive }) => (
              <>
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 z-10",
                    overlayPassthroughActive && "pointer-events-none-deep",
                  )}
                >
                  {canvasMode !== "avatar"
                    ? (renderedChatPanel ?? <RuntimeChatPlaceholder />)
                    : null}
                  {canvasMode === "avatar" && avatarOnlyOverlay ? (
                    <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
                      {avatarOnlyOverlay}
                    </div>
                  ) : null}
                </div>
                <Header
                  actions={actions}
                  left={headerLeft}
                  center={headerCenter}
                  right={
                    <div className="flex items-center gap-2">
                      {headerRight ?? actions}
                      <CanvasControls
                        backgroundMode={backgroundMode}
                        cameraControls={cameraControls}
                        portalContainer={canvasWrapperElement}
                        isFullscreen={isFullscreen}
                        isPipSupported={isPipSupported}
                        mode={canvasMode}
                        onBackgroundModeChange={setBackgroundMode}
                        onMaximize={handleEnterFullscreen}
                        onMinimize={handleExitFullscreen}
                        onModeChange={handleCanvasModeChange}
                        onPictureInPicture={handlePictureInPicture}
                        showBackgroundModeControl={showBackgroundModeControl}
                      />
                    </div>
                  }
                  onMenuClick={headerOnMenuClick}
                  className="pointer-events-none absolute inset-x-0 top-0 z-20"
                />
                {children}
              </>
            )}
          </AvatarSceneHost>
        </div>
      </main>
    </div>
  );
}

export function RuntimeChatPlaceholder({
  label = "Runtime chat unavailable",
}: {
  label?: string;
}) {
  return (
    <div className="pointer-events-auto flex h-full w-full items-end justify-center p-4">
      <div className="border-border/70 bg-background/82 text-muted-foreground mb-20 w-full max-w-3xl rounded-xl border p-4 text-sm shadow-lg backdrop-blur-md">
        <p className="text-foreground font-medium">{label}</p>
        <p className="mt-1">
          The runtime shell, scene, avatar, settings, websocket, and memory
          surfaces are active, but no chat panel was provided for this shell.
        </p>
      </div>
    </div>
  );
}
