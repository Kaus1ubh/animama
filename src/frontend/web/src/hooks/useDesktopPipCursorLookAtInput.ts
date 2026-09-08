"use client";

import { useEffect, useMemo, useRef } from "react";

import type { CursorLookAtInputProvider } from "@/lib/avatar";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

const MAX_CURSOR_SNAPSHOT_AGE_MS = 500;

export function useDesktopPipCursorLookAtInput(
  enabled: boolean,
): CursorLookAtInputProvider | null {
  const platform = useRuntimePlatform();
  const latestSnapshotRef = useRef<DesktopPipCursorSnapshot | null>(null);
  const pipBridge =
    platform.kind === "desktop" && platform.capabilities.nativePiP
      ? (platform.desktopBridge.pip ?? null)
      : null;
  const isPipWindow =
    platform.kind === "desktop" && platform.desktopBridge.windowRole === "pip";
  const canUseGlobalPipCursor = Boolean(
    enabled && isPipWindow && pipBridge?.onCursorSnapshot,
  );

  useEffect(() => {
    latestSnapshotRef.current = null;
    if (!canUseGlobalPipCursor || !pipBridge?.onCursorSnapshot) return;

    const unsubscribe = pipBridge.onCursorSnapshot((snapshot) => {
      latestSnapshotRef.current = snapshot;
    });

    return () => {
      latestSnapshotRef.current = null;
      unsubscribe();
    };
  }, [canUseGlobalPipCursor, pipBridge]);

  return useMemo(() => {
    if (!canUseGlobalPipCursor) return null;

    return () => {
      const snapshot = latestSnapshotRef.current;
      if (!snapshot) return null;
      if (Date.now() - snapshot.sentAtMs > MAX_CURSOR_SNAPSHOT_AGE_MS) {
        return null;
      }

      return {
        clientX: snapshot.local.x,
        clientY: snapshot.local.y,
        capturedAtMs: snapshot.sentAtMs,
        isInsideViewport: snapshot.isInsidePip,
        source: "desktop-pip",
      };
    };
  }, [canUseGlobalPipCursor]);
}
