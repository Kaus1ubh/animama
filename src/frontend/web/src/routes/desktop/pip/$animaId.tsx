"use client";

import { createFileRoute, redirect } from "@tanstack/react-router";
import { Camera, GripHorizontal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type WheelEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { useDesktopPipRuntimeConsumer } from "@/hooks/useDesktopPipRuntimeSync";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { cn } from "@/lib/utils";
import { AvatarSceneHost } from "@/ui/main/canvas/AvatarSceneHost";
import { cameraPresetLabel } from "@/ui/main/canvas/SceneCameraPresetControl";
import {
  DEFAULT_PIP_SCENE_CAMERA_PRESET,
  SCENE_CAMERA_PRESETS,
} from "@/ui/main/canvas/sceneCameraPresets";
import { AnimaRouteProviders } from "@/ui/app/AnimaRouteProviders";
import { SettingsProvider } from "@/ui/settings/SettingsProvider";

const MIN_PIP_SIZE_SCALE = 0.275;
const MAX_PIP_SIZE_SCALE = 1.6;
const PIP_SIZE_SLIDER_STEP = 0.05;
const PIP_WHEEL_RESIZE_INTERVAL_MS = 60;

function isDesktopPipWindow(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.animamaDesktop;
  return Boolean(
    bridge?.isDesktop && bridge.windowRole === "pip" && bridge.pip,
  );
}

export const Route = createFileRoute("/desktop/pip/$animaId")({
  beforeLoad: () => {
    if (!isDesktopPipWindow()) throw redirect({ to: "/" });
  },
  component: DesktopPipRoute,
});

function useTransparentPipDocument(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const body = document.body;
    const appRoot = document.getElementById("root");
    root.setAttribute("data-animama-pip", "true");
    body.setAttribute("data-animama-pip", "true");
    appRoot?.setAttribute("data-animama-pip", "true");

    return () => {
      root.removeAttribute("data-animama-pip");
      body.removeAttribute("data-animama-pip");
      appRoot?.removeAttribute("data-animama-pip");
    };
  }, [active]);
}

function clampPipSizeScale(value: number): number {
  if (!Number.isFinite(value)) return MIN_PIP_SIZE_SCALE;
  return Math.max(MIN_PIP_SIZE_SCALE, Math.min(MAX_PIP_SIZE_SCALE, value));
}

function DesktopPipRoute() {
  const { t } = useTranslation("app");
  const { t: tChat } = useTranslation("chat");
  const { animaId } = Route.useParams();
  const platform = useRuntimePlatform();
  const pipBridge =
    platform.kind === "desktop" && platform.capabilities.nativePiP
      ? (platform.desktopBridge.pip ?? null)
      : null;
  const {
    backgroundMode,
    isHovered,
    requestCameraPreset,
    sizeScale,
    visualState,
  } = useDesktopPipRuntimeConsumer();
  const cameraPreset =
    visualState?.cameraPreset ?? DEFAULT_PIP_SCENE_CAMERA_PRESET;
  const cameraLabel = t("pip.switchCamera", {
    preset: cameraPresetLabel(tChat, cameraPreset),
  });
  const sizeScaleRef = useRef(sizeScale);
  const lastWheelResizeAtRef = useRef(0);
  const [draftSizeScale, setDraftSizeScale] = useState(sizeScale);
  const transparent = backgroundMode === "transparent";
  useTransparentPipDocument(transparent);

  useEffect(() => {
    sizeScaleRef.current = sizeScale;
    setDraftSizeScale(sizeScale);
  }, [sizeScale]);

  const setPipSizeScale = useCallback(
    (nextSizeScale: number) => {
      const clampedSizeScale = clampPipSizeScale(nextSizeScale);
      sizeScaleRef.current = clampedSizeScale;
      setDraftSizeScale(clampedSizeScale);
      void pipBridge?.setSizeScale(clampedSizeScale).catch(() => {});
    },
    [pipBridge],
  );

  const handleClose = () => {
    void pipBridge?.close().catch(() => {});
  };

  // Each click moves to the next preset; the owner window applies it.
  const handleCameraPresetCycle = () => {
    const index = SCENE_CAMERA_PRESETS.indexOf(cameraPreset);
    requestCameraPreset(
      SCENE_CAMERA_PRESETS[(index + 1) % SCENE_CAMERA_PRESETS.length],
    );
  };

  const handleSizeScaleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPipSizeScale(Number(event.currentTarget.value));
  };

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!pipBridge || event.deltaY === 0) return;
      const now = performance.now();
      if (now - lastWheelResizeAtRef.current < PIP_WHEEL_RESIZE_INTERVAL_MS) {
        return;
      }
      lastWheelResizeAtRef.current = now;
      event.preventDefault();

      const direction = event.deltaY < 0 ? 1 : -1;
      setPipSizeScale(sizeScaleRef.current + direction * PIP_SIZE_SLIDER_STEP);
    },
    [pipBridge, setPipSizeScale],
  );

  return (
    <SettingsProvider animaId={animaId}>
      <AnimaRouteProviders>
        <div
          onWheel={handleWheel}
          className={cn(
            "relative h-screen w-screen overflow-hidden",
            transparent ? "bg-transparent" : "bg-background",
          )}
        >
          <AvatarSceneHost
            avatarTransformOverride={visualState?.avatarTransform ?? null}
            backgroundMode={backgroundMode}
            className={cn(
              "transition-opacity duration-150",
              isHovered && "opacity-30",
            )}
            mode="pip"
            pipCameraPreset={cameraPreset}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-40 border-2 border-sky-400/95 opacity-0 transition-opacity",
              isHovered && "opacity-100",
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              "anima-pip-drag bg-background/60 text-foreground/70 pointer-events-auto absolute top-1 left-1 z-50 inline-flex h-3.5 w-3.5 cursor-grab items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur-md transition-opacity",
              isHovered && "opacity-100",
            )}
          >
            <GripHorizontal className="h-2 w-2" />
          </div>
          <input
            type="range"
            aria-label={t("pip.resize")}
            min={MIN_PIP_SIZE_SCALE}
            max={MAX_PIP_SIZE_SCALE}
            step={PIP_SIZE_SLIDER_STEP}
            value={draftSizeScale}
            onChange={handleSizeScaleChange}
            className={cn(
              "anima-pip-no-drag pointer-events-auto absolute top-1 right-6 left-6 z-50 h-3.5 accent-sky-400 opacity-0 transition-opacity",
              isHovered && "opacity-100",
            )}
          />
          <button
            type="button"
            aria-label={t("pip.close")}
            onClick={handleClose}
            className={cn(
              "anima-pip-no-drag bg-background/60 text-foreground/70 hover:bg-background/80 hover:text-foreground pointer-events-auto absolute top-1 right-1 z-50 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur-md transition focus-visible:opacity-100",
              isHovered && "opacity-100",
            )}
          >
            <X className="h-2 w-2" />
          </button>
          <button
            type="button"
            aria-label={cameraLabel}
            title={cameraLabel}
            onClick={handleCameraPresetCycle}
            className={cn(
              "anima-pip-no-drag bg-background/60 text-foreground/70 hover:bg-background/80 hover:text-foreground pointer-events-auto absolute bottom-1 left-1 z-50 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur-md transition focus-visible:opacity-100",
              isHovered && "opacity-100",
            )}
          >
            <Camera className="h-2 w-2" />
          </button>
        </div>
      </AnimaRouteProviders>
    </SettingsProvider>
  );
}
