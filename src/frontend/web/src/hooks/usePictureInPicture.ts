import { useDocumentPiP } from "@/hooks/useDocumentPiP";
import { useDesktopPiP } from "@/hooks/useDesktopPiP";
import type { CanvasMode } from "@/ui/main/canvas/CanvasControls";

type UsePictureInPictureOptions = {
  canvasMode: CanvasMode;
  setCanvasMode: (mode: CanvasMode) => void;
};

export function usePictureInPicture({
  canvasMode,
  setCanvasMode,
}: UsePictureInPictureOptions) {
  const documentPip = useDocumentPiP({ canvasMode, setCanvasMode });
  const desktopPip = useDesktopPiP({ canvasMode, setCanvasMode });

  if (desktopPip.isAvailable) {
    return {
      canvasHostRef: documentPip.canvasHostRef,
      backgroundMode: desktopPip.backgroundMode,
      closePip: desktopPip.closePip,
      /** PiP is the desktop app's own window, which a shortcut can open. */
      isDesktopPip: true,
      isPipActive: desktopPip.isPipActive,
      isPipSupported: desktopPip.isPipSupported,
      setBackgroundMode: desktopPip.setBackgroundMode,
      showBackgroundModeControl: true,
      suspendMainScene: desktopPip.isPipActive,
      togglePip: desktopPip.togglePip,
    };
  }

  return {
    canvasHostRef: documentPip.canvasHostRef,
    backgroundMode: "scene" as const,
    closePip: documentPip.closePip,
    isDesktopPip: false,
    isPipActive: documentPip.isPipActive,
    isPipSupported: documentPip.isPipSupported,
    setBackgroundMode: undefined,
    showBackgroundModeControl: false,
    suspendMainScene: false,
    togglePip: documentPip.togglePip,
  };
}
