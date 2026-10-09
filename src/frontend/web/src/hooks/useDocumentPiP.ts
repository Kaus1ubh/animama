"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CanvasMode } from "@/ui/main/canvas/CanvasControls";

type DocumentPictureInPicture = {
  requestWindow: (options?: {
    width?: number;
    height?: number;
  }) => Promise<Window>;
};

type PipWindowSize = {
  width: number;
  height: number;
};

const MAX_PIP_WIDTH = 520;
const MAX_PIP_HEIGHT = 360;
const MIN_PIP_SIZE = 180;

const getDocumentPiP = () => {
  if (typeof window === "undefined") return null;
  return (
    (
      window as Window & {
        documentPictureInPicture?: DocumentPictureInPicture;
      }
    ).documentPictureInPicture ?? null
  );
};

const syncPipDocument = (pipDocument: Document) => {
  pipDocument.head.innerHTML = "";
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    pipDocument.head.append(node.cloneNode(true));
  });

  pipDocument.documentElement.className = document.documentElement.className;
  pipDocument.body.className = document.body.className;
  pipDocument.documentElement.style.height = "100%";
  pipDocument.body.style.height = "100%";
  pipDocument.body.style.margin = "0";
  pipDocument.body.style.overflow = "hidden";
  pipDocument.body.style.background = getComputedStyle(
    document.body,
  ).backgroundColor;
};

const clampPipSize = (value: number) =>
  Math.max(MIN_PIP_SIZE, Math.round(value));

const getPipWindowSize = (host: HTMLElement): PipWindowSize => {
  const rect = host.getBoundingClientRect();
  const hasValidSize = rect.width > 0 && rect.height > 0;
  const aspectRatio = hasValidSize ? rect.width / rect.height : 16 / 9;

  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return {
      width: MAX_PIP_WIDTH,
      height: MAX_PIP_HEIGHT,
    };
  }

  const widthFromHeight = MAX_PIP_HEIGHT * aspectRatio;
  if (widthFromHeight <= MAX_PIP_WIDTH) {
    return {
      width: clampPipSize(widthFromHeight),
      height: MAX_PIP_HEIGHT,
    };
  }

  return {
    width: MAX_PIP_WIDTH,
    height: clampPipSize(MAX_PIP_WIDTH / aspectRatio),
  };
};

type UseDocumentPipOptions = {
  canvasMode: CanvasMode;
  setCanvasMode: (mode: CanvasMode) => void;
};

export function useDocumentPiP({
  canvasMode,
  setCanvasMode,
}: UseDocumentPipOptions) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasHostParentRef = useRef<HTMLElement | null>(null);
  const canvasHostPlaceholderRef = useRef<Comment | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const pipActiveRef = useRef(false);
  const lifetimeRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const [isPipActive, setIsPipActive] = useState(false);
  const [isPipSupported] = useState(() => Boolean(getDocumentPiP()));

  const restoreCanvasHost = useCallback(() => {
    const host = canvasHostRef.current;
    const parent = canvasHostParentRef.current;
    const placeholder = canvasHostPlaceholderRef.current;
    const placeholderParent = placeholder?.parentNode as Node | null;

    if (host) {
      if (placeholder && placeholderParent) {
        placeholderParent.insertBefore(host, placeholder);
        placeholderParent.removeChild(placeholder);
      } else if (parent?.isConnected) {
        parent.prepend(host);
      }

      host.style.width = "";
      host.style.height = "";
    } else if (placeholder && placeholderParent) {
      placeholderParent.removeChild(placeholder);
    }

    canvasHostParentRef.current = null;
    canvasHostPlaceholderRef.current = null;
  }, []);

  const handlePipClosed = useCallback(() => {
    if (!pipActiveRef.current) return;
    pipActiveRef.current = false;
    setIsPipActive(false);
    pipWindowRef.current = null;
    restoreCanvasHost();
  }, [restoreCanvasHost]);

  const openPip = useCallback(async () => {
    const docPip = getDocumentPiP();
    if (!docPip || pipActiveRef.current || pendingRef.current !== null) return;

    const host = canvasHostRef.current;
    if (!host || !host.parentElement) return;

    const pipWindowSize = getPipWindowSize(host);
    const lifetime = lifetimeRef.current;
    pendingRef.current = lifetime;
    let pip: Window;
    try {
      pip = await docPip.requestWindow(pipWindowSize);
    } catch (error) {
      if (
        lifetime === lifetimeRef.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        toast.error(
          "Picture-in-picture is unavailable. Keep using the companion in this window.",
        );
      return;
    } finally {
      if (pendingRef.current === lifetime) pendingRef.current = null;
    }
    // Browser permission/window creation can settle after navigation or sign-out.
    if (
      lifetime !== lifetimeRef.current ||
      canvasHostRef.current !== host ||
      !host.isConnected
    ) {
      pip.close();
      return;
    }
    pipWindowRef.current = pip;
    pipActiveRef.current = true;
    setIsPipActive(true);

    syncPipDocument(pip.document);

    const parent = host.parentElement;
    const placeholder = document.createComment("anima-document-pip-host");
    parent.insertBefore(placeholder, host);
    canvasHostParentRef.current = parent;
    canvasHostPlaceholderRef.current = placeholder;
    pip.document.body.append(host);
    host.style.width = "100%";
    host.style.height = "100%";

    pip.addEventListener("pagehide", handlePipClosed);
    pip.addEventListener("unload", handlePipClosed);
  }, [handlePipClosed]);

  const closePip = useCallback(() => {
    lifetimeRef.current++;
    pendingRef.current = null;
    const pip = pipWindowRef.current;
    if (!pip) return;
    pipActiveRef.current = false;
    setIsPipActive(false);
    restoreCanvasHost();
    pipWindowRef.current = null;
    pip.close();
  }, [restoreCanvasHost]);

  const togglePip = useCallback(async () => {
    if (pipWindowRef.current) {
      closePip();
      return;
    }
    if (canvasMode === "chat") {
      setCanvasMode("avatar-chat");
      requestAnimationFrame(() => {
        void openPip();
      });
      return;
    }
    await openPip();
  }, [canvasMode, closePip, openPip, setCanvasMode]);

  useEffect(() => {
    return () => {
      closePip();
    };
  }, [closePip]);

  return {
    canvasHostRef,
    isPipActive,
    isPipSupported,
    togglePip,
    closePip,
  };
}
