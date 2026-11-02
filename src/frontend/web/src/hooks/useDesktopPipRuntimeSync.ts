"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";

import {
  applyDesktopPipPlannerEventsConsumed,
  applyDesktopPipVisualState,
  captureDesktopPipVisualState,
  isDesktopPipVisualState,
  watchDesktopPipPlannerEventConsumption,
  type DesktopPipPlannerEventsConsumed,
  type DesktopPipVisualState,
} from "@/lib/desktop-pip/visual-state";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  isProviderTimingOnlyChange,
  useAvatarLipSyncBridgeStore,
} from "@/stores/avatar-lipsync-bridge-store";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import {
  isSceneCameraPreset,
  type SceneCameraPreset,
} from "@/ui/main/canvas/sceneCameraPresets";
import type { AvatarTransform } from "@/ui/main/canvas/transform-state";

type UseDesktopPipRuntimeProducerOptions = {
  avatarTransform: AvatarTransform;
  backgroundMode: DesktopPipBackgroundMode;
  cameraPreset: SceneCameraPreset;
  enabled: boolean;
  /** The PiP window asked for another camera preset. */
  onCameraPresetRequest?: (preset: SceneCameraPreset) => void;
};

type UseDesktopPipRuntimeConsumerResult = {
  backgroundMode: DesktopPipBackgroundMode;
  isHovered: boolean;
  sizeScale: number;
  visualState: DesktopPipVisualState | null;
  /** Ask the owner window to frame PiP with `preset`. */
  requestCameraPreset: (preset: SceneCameraPreset) => void;
};

const SNAPSHOT_THROTTLE_MS = 60;
const DEFAULT_PIP_SIZE_SCALE = 0.5;

function createRuntimeMessage(args: {
  payload:
    | DesktopPipVisualState
    | DesktopPipPlannerEventsConsumed
    | { kind: "ready" }
    | { kind: "camera-preset"; preset: SceneCameraPreset };
  animaId: string;
  sequence: number;
  type: DesktopPipRuntimeMessage["type"];
}): DesktopPipRuntimeMessage {
  return {
    type: args.type,
    sequence: args.sequence,
    sentAtMs: performance.now(),
    animaId: args.animaId,
    payload: args.payload,
  };
}

export function useDesktopPipRuntimeProducer({
  avatarTransform,
  backgroundMode,
  cameraPreset,
  enabled,
  onCameraPresetRequest,
}: UseDesktopPipRuntimeProducerOptions): void {
  const platform = useRuntimePlatform();
  const params = useParams({ strict: false });
  const animaId = typeof params?.animaId === "string" ? params.animaId : null;
  const pipBridge =
    platform.kind === "desktop" && platform.capabilities.nativePiP
      ? (platform.desktopBridge.pip ?? null)
      : null;
  const isPipWindow =
    platform.kind === "desktop" && platform.desktopBridge.windowRole === "pip";
  const sequenceRef = useRef(0);
  const latestVisualInputsRef = useRef({
    avatarTransform,
    backgroundMode,
    cameraPreset,
  });
  const onCameraPresetRequestRef = useRef(onCameraPresetRequest);
  const snapshotTimerRef = useRef<number | null>(null);

  useEffect(() => {
    latestVisualInputsRef.current = {
      avatarTransform,
      backgroundMode,
      cameraPreset,
    };
  }, [avatarTransform, backgroundMode, cameraPreset]);

  useEffect(() => {
    onCameraPresetRequestRef.current = onCameraPresetRequest;
  }, [onCameraPresetRequest]);

  const publishSnapshot = useCallback(
    (messageType: DesktopPipRuntimeMessage["type"] = "snapshot") => {
      if (!enabled || !pipBridge || !animaId || isPipWindow) return;
      sequenceRef.current += 1;
      const payload = captureDesktopPipVisualState(
        latestVisualInputsRef.current,
      );
      void pipBridge
        .publishRuntimeMessage(
          createRuntimeMessage({
            payload,
            animaId,
            sequence: sequenceRef.current,
            type: messageType,
          }),
        )
        .catch(() => {});
    },
    [enabled, isPipWindow, animaId, pipBridge],
  );

  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimerRef.current !== null) return;
    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null;
      publishSnapshot("incremental");
    }, SNAPSHOT_THROTTLE_MS);
  }, [publishSnapshot]);

  useEffect(() => {
    if (!enabled || !pipBridge || !animaId || isPipWindow) return;

    const unsubscribe = pipBridge.onRuntimeMessage((message) => {
      if (message.animaId !== animaId) return;
      if (message.type === "ready") {
        publishSnapshot("snapshot");
        return;
      }
      if (message.type === "planner-events-consumed") {
        applyDesktopPipPlannerEventsConsumed(message.payload);
        return;
      }
      if (message.type !== "camera-preset") return;
      const payload = message.payload as { preset?: unknown } | null;
      if (isSceneCameraPreset(payload?.preset)) {
        onCameraPresetRequestRef.current?.(payload.preset);
      }
    });

    void pipBridge
      .getState()
      .then((state) => {
        if (state.isOpen && state.animaId === animaId) {
          publishSnapshot("snapshot");
        }
      })
      .catch(() => {});

    return () => {
      unsubscribe();
    };
  }, [enabled, isPipWindow, animaId, pipBridge, publishSnapshot]);

  useEffect(() => {
    if (!enabled || !pipBridge || !animaId || isPipWindow) return;
    scheduleSnapshot();
  }, [
    avatarTransform,
    backgroundMode,
    cameraPreset,
    enabled,
    isPipWindow,
    animaId,
    pipBridge,
    scheduleSnapshot,
  ]);

  useEffect(() => {
    if (!enabled || !pipBridge || !animaId || isPipWindow) return;

    const unsubscribeAvatarRuntime = useAvatarRuntimeStore.subscribe(() => {
      scheduleSnapshot();
    });
    const unsubscribeLipSync = useAvatarLipSyncBridgeStore.subscribe(
      (state, previous) => {
        // The PiP window does not mirror provider timing, which updates with
        // every realtime audio frame.
        if (isProviderTimingOnlyChange(state, previous)) return;
        scheduleSnapshot();
      },
    );

    return () => {
      unsubscribeAvatarRuntime();
      unsubscribeLipSync();
      if (snapshotTimerRef.current !== null) {
        window.clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
    };
  }, [enabled, isPipWindow, animaId, pipBridge, scheduleSnapshot]);
}

export function useDesktopPipRuntimeConsumer(): UseDesktopPipRuntimeConsumerResult {
  const platform = useRuntimePlatform();
  const params = useParams({ strict: false });
  const animaId = typeof params?.animaId === "string" ? params.animaId : null;
  const pipBridge =
    platform.kind === "desktop" && platform.capabilities.nativePiP
      ? (platform.desktopBridge.pip ?? null)
      : null;
  const sequenceRef = useRef(0);
  const [visualState, setVisualState] = useState<DesktopPipVisualState | null>(
    null,
  );
  const [backgroundMode, setBackgroundMode] =
    useState<DesktopPipBackgroundMode>("transparent");
  const [isHovered, setIsHovered] = useState(false);
  const [sizeScale, setSizeScale] = useState(DEFAULT_PIP_SIZE_SCALE);

  useEffect(() => {
    if (!pipBridge || !animaId) return;

    const unsubscribeRuntime = pipBridge.onRuntimeMessage((message) => {
      if (
        message.animaId !== animaId ||
        (message.type !== "snapshot" && message.type !== "incremental") ||
        !isDesktopPipVisualState(message.payload)
      ) {
        return;
      }
      if (message.sequence < sequenceRef.current) {
        return;
      }
      sequenceRef.current = message.sequence;
      applyDesktopPipVisualState(message.payload);
      setVisualState(message.payload);
      setBackgroundMode(message.payload.backgroundMode);
    });
    // The owner's scene is suspended, so only this window's Avatar consumes
    // planner events; tell the owner, or its snapshots replay them.
    const stopWatchingPlannerEvents = watchDesktopPipPlannerEventConsumption(
      (eventIds) => {
        // Like `ready`, a report is outside the owner's snapshot sequence.
        void pipBridge
          .publishRuntimeMessage(
            createRuntimeMessage({
              payload: { kind: "planner-events-consumed", eventIds },
              animaId,
              sequence: 0,
              type: "planner-events-consumed",
            }),
          )
          .catch(() => {});
      },
    );
    const unsubscribeState = pipBridge.onStateChange((state) => {
      if (state.animaId === animaId) {
        setBackgroundMode(state.backgroundMode);
        setIsHovered(state.isHovered);
        setSizeScale(state.sizeScale);
        return;
      }
      setIsHovered(false);
    });

    void pipBridge
      .publishRuntimeMessage(
        createRuntimeMessage({
          payload: { kind: "ready" },
          animaId,
          sequence: 0,
          type: "ready",
        }),
      )
      .catch(() => {});
    void pipBridge
      .getState()
      .then((state) => {
        if (state.animaId === animaId) {
          setBackgroundMode(state.backgroundMode);
          setIsHovered(state.isHovered);
          setSizeScale(state.sizeScale);
        }
      })
      .catch(() => {});

    return () => {
      unsubscribeRuntime();
      unsubscribeState();
      stopWatchingPlannerEvents();
    };
  }, [animaId, pipBridge]);

  const requestCameraPreset = useCallback(
    (preset: SceneCameraPreset) => {
      if (!pipBridge || !animaId) return;
      // Like `ready`, a request is outside the owner's snapshot sequence.
      void pipBridge
        .publishRuntimeMessage(
          createRuntimeMessage({
            payload: { kind: "camera-preset", preset },
            animaId,
            sequence: 0,
            type: "camera-preset",
          }),
        )
        .catch(() => {});
    },
    [animaId, pipBridge],
  );

  return {
    backgroundMode,
    isHovered,
    requestCameraPreset,
    sizeScale,
    visualState,
  };
}
