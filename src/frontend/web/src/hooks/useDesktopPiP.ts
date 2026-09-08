"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import type { CanvasMode } from "@/ui/main/canvas/CanvasControls";

type AnimamaDesktopPipBridge = NonNullable<
  NonNullable<Window["animamaDesktop"]>["pip"]
>;

type UseDesktopPipOptions = {
  canvasMode: CanvasMode;
  setCanvasMode: (mode: CanvasMode) => void;
};

type DesktopPipControls = {
  backgroundMode: DesktopPipBackgroundMode;
  closePip: () => void;
  isAvailable: boolean;
  isPipActive: boolean;
  isPipSupported: boolean;
  setBackgroundMode: (mode: DesktopPipBackgroundMode) => void;
  togglePip: () => void;
};

const DEFAULT_BACKGROUND_MODE: DesktopPipBackgroundMode = "transparent";
const DEFAULT_SIZE_SCALE = 0.5;

function runPipStateRequest(
  request: Promise<DesktopPipState>,
  onState: (state: DesktopPipState) => void,
): void {
  void request.then(onState).catch(() => {});
}

export function useDesktopPiP({
  canvasMode,
  setCanvasMode,
}: UseDesktopPipOptions): DesktopPipControls {
  const platform = useRuntimePlatform();
  const params = useParams({ strict: false });
  const animaId = typeof params?.animaId === "string" ? params.animaId : null;
  const chatId = typeof params?.chatId === "string" ? params.chatId : null;
  const desktopPip: AnimamaDesktopPipBridge | null =
    platform.kind === "desktop" && platform.capabilities.nativePiP
      ? (platform.desktopBridge.pip ?? null)
      : null;
  const isPipWindow =
    platform.kind === "desktop" && platform.desktopBridge.windowRole === "pip";
  const [state, setState] = useState<DesktopPipState>({
    isOpen: false,
    animaId: null,
    chatId: null,
    backgroundMode: DEFAULT_BACKGROUND_MODE,
    isHovered: false,
    sizeScale: DEFAULT_SIZE_SCALE,
  });
  const isAvailable = Boolean(desktopPip && animaId && !isPipWindow);

  useEffect(() => {
    if (!desktopPip || isPipWindow) {
      setState((current) => ({
        ...current,
        isOpen: false,
        isHovered: false,
      }));
      return;
    }

    let isMounted = true;
    const unsubscribe = desktopPip.onStateChange((nextState) => {
      setState(nextState);
    });
    void desktopPip
      .getState()
      .then((nextState) => {
        if (isMounted) {
          setState(nextState);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [desktopPip, isPipWindow]);

  useEffect(() => {
    return () => {
      if (desktopPip && !isPipWindow) {
        void desktopPip.close().catch(() => {});
      }
    };
  }, [desktopPip, isPipWindow]);

  const openOptions = useMemo<DesktopPipOpenOptions | null>(() => {
    if (!animaId) return null;
    return {
      animaId,
      chatId,
      backgroundMode: state.backgroundMode,
    };
  }, [chatId, animaId, state.backgroundMode]);

  const closePip = useCallback(() => {
    if (!desktopPip || isPipWindow) return;
    runPipStateRequest(desktopPip.close(), setState);
  }, [desktopPip, isPipWindow]);

  const togglePip = useCallback(() => {
    if (!desktopPip || !openOptions || isPipWindow) return;
    if (canvasMode === "chat") {
      setCanvasMode("avatar-chat");
      requestAnimationFrame(() => {
        runPipStateRequest(desktopPip.toggle(openOptions), setState);
      });
      return;
    }
    runPipStateRequest(desktopPip.toggle(openOptions), setState);
  }, [canvasMode, desktopPip, isPipWindow, openOptions, setCanvasMode]);

  const setBackgroundMode = useCallback(
    (mode: DesktopPipBackgroundMode) => {
      if (!desktopPip || isPipWindow) {
        setState((current) => ({
          ...current,
          backgroundMode: mode,
        }));
        return;
      }
      runPipStateRequest(desktopPip.setBackgroundMode(mode), setState);
    },
    [desktopPip, isPipWindow],
  );

  return {
    backgroundMode: state.backgroundMode,
    closePip,
    isAvailable,
    isPipActive: state.isOpen,
    isPipSupported: isAvailable,
    setBackgroundMode,
    togglePip,
  };
}
