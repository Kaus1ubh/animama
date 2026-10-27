"use client";

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useDesktopPipShortcut } from "@/hooks/useDesktopPipShortcut";
import { useFullscreen } from "@/hooks/useFullscreen";
import { usePictureInPicture } from "@/hooks/usePictureInPicture";
import { cn } from "@/lib/utils";
import { usePauseShineWhileInactive } from "@/hooks/usePauseShineWhileInactive";
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
  /** Content laid over the scene in Avatar-only mode, where no chat panel is rendered. */
  avatarOnlyOverlay?: ReactNode;
  headerLeft?: ReactNode;
  headerCenter?: ReactNode;
  headerRight?: ReactNode;
  headerOnMenuClick?: () => void;
  /**
   * Whether the desktop PiP shortcut may run. The route holds it back, like
   * the chat's shortcuts, until the first-run confirmation is accepted.
   */
  pipShortcutEnabled?: boolean;
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
  pipShortcutEnabled = false,
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
    isDesktopPip,
    isPipActive,
    isPipSupported,
    setBackgroundMode,
    showBackgroundModeControl,
    suspendMainScene,
    togglePip,
  } = usePictureInPicture({ canvasMode, setCanvasMode });
  usePauseShineWhileInactive(isPipActive);
  useDesktopPipShortcut({
    available: isDesktopPip && pipShortcutEnabled,
    onToggle: togglePip,
  });
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

  // The scene extends up into the app shell's title-strip padding, so it fills
  // the strip behind the desktop window buttons; the header and chat start
  // below the strip.
  return (
    <div
      className={cn(
        "-mt-(--app-titlebar-height) flex min-h-0 w-full min-w-0 flex-1 flex-col transition-[margin-left,width] duration-150 ease-in-out",
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
                    "pointer-events-none absolute inset-x-0 top-(--app-titlebar-height) bottom-0 z-10",
                    overlayPassthroughActive && "pointer-events-none-deep",
                  )}
                >
                  {canvasMode !== "avatar"
                    ? (renderedChatPanel ?? <RuntimeChatPlaceholder />)
                    : null}
                  {canvasMode === "avatar" && avatarOnlyOverlay ? (
                    <div className="absolute inset-0">{avatarOnlyOverlay}</div>
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
                  className="pointer-events-none absolute inset-x-0 top-(--app-titlebar-height) z-20"
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

export function RuntimeChatPlaceholder({ label }: { label?: string }) {
  const { t } = useTranslation("chat");
  return (
    <div className="pointer-events-auto flex h-full w-full items-end justify-center p-4">
      <div className="border-border/70 bg-background/82 text-muted-foreground mb-20 w-full max-w-3xl rounded-xl border p-4 text-sm shadow-lg backdrop-blur-md">
        <p className="text-foreground font-medium">
          {label ?? t("shell.chatUnavailable.title")}
        </p>
        <p className="mt-1">{t("shell.chatUnavailable.description")}</p>
      </div>
    </div>
  );
}
