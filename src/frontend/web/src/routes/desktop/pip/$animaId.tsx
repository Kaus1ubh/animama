"use client";

import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  Camera,
  ImageIcon,
  Move,
  MoveDiagonal2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
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
import { Button } from "@/ui/components/button";
import { Slider } from "@/ui/components/slider";
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

/**
 * An icon button in the hover toolbar. The label doubles as a native tooltip,
 * which the OS draws outside the small PiP window.
 */
function PipToolbarButton({
  icon: Icon,
  label,
  pressed,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  /** Set for toggles; leave undefined for plain actions. */
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="anima-pip-no-drag text-foreground/80 aria-pressed:bg-accent aria-pressed:text-accent-foreground size-5 shrink-0 rounded-sm"
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </Button>
  );
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
  const [sizeSliderOpen, setSizeSliderOpen] = useState(false);
  const transparent = backgroundMode === "transparent";
  useTransparentPipDocument(transparent);

  useEffect(() => {
    sizeScaleRef.current = sizeScale;
    setDraftSizeScale(sizeScale);
  }, [sizeScale]);

  // The toolbar hides when the cursor leaves; it reopens with its buttons.
  useEffect(() => {
    if (!isHovered) setSizeSliderOpen(false);
  }, [isHovered]);

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

  const handleBackgroundToggle = () => {
    void pipBridge
      ?.setBackgroundMode(transparent ? "scene" : "transparent")
      .catch(() => {});
  };

  const handleToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && sizeSliderOpen) {
      event.preventDefault();
      setSizeSliderOpen(false);
    }
  };

  // The main process resizes the window while the grip is held.
  const handleResizeGripPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !pipBridge?.setGripResizing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void pipBridge.setGripResizing(true).catch(() => {});
  };

  const handleResizeGripRelease = () => {
    void pipBridge?.setGripResizing?.(false).catch(() => {});
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
              "border-ring/70 pointer-events-none absolute inset-0 z-40 border opacity-0 transition-opacity duration-150",
              isHovered && "opacity-100",
            )}
          />
          {/* The bar's background moves the window; its controls opt out. */}
          <div
            role="toolbar"
            aria-label={t("pip.controls")}
            onKeyDown={handleToolbarKeyDown}
            className={cn(
              "anima-pip-drag bg-background/80 border-border/60 absolute top-1 right-1 left-1 z-50 flex cursor-grab items-center rounded-md border p-0.5 opacity-0 shadow-sm backdrop-blur-md transition-opacity duration-150",
              isHovered && "opacity-100",
            )}
          >
            {sizeSliderOpen ? (
              <Slider
                min={MIN_PIP_SIZE_SCALE}
                max={MAX_PIP_SIZE_SCALE}
                step={PIP_SIZE_SLIDER_STEP}
                value={[draftSizeScale]}
                onValueChange={([value]) => {
                  if (value !== undefined) setPipSizeScale(value);
                }}
                thumbProps={{ "aria-label": t("pip.resize") }}
                className="anima-pip-no-drag mx-1.5 min-w-0 flex-1 cursor-default"
              />
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="text-muted-foreground flex min-w-0 flex-1 items-center overflow-hidden"
                >
                  <Move className="size-3.5 shrink-0" />
                </span>
                <PipToolbarButton
                  icon={Camera}
                  label={cameraLabel}
                  onClick={handleCameraPresetCycle}
                />
                <PipToolbarButton
                  icon={ImageIcon}
                  label={t("pip.sceneBackground")}
                  pressed={!transparent}
                  onClick={handleBackgroundToggle}
                />
              </>
            )}
            <PipToolbarButton
              icon={MoveDiagonal2}
              label={t("pip.resize")}
              pressed={sizeSliderOpen}
              onClick={() => setSizeSliderOpen((open) => !open)}
            />
            <span
              aria-hidden="true"
              className="bg-border mx-0.5 h-3.5 w-px shrink-0"
            />
            <PipToolbarButton
              icon={X}
              label={t("pip.close")}
              onClick={handleClose}
            />
          </div>
          {pipBridge?.setGripResizing ? (
            <div
              aria-hidden="true"
              onPointerDown={handleResizeGripPointerDown}
              onPointerUp={handleResizeGripRelease}
              onPointerCancel={handleResizeGripRelease}
              onLostPointerCapture={handleResizeGripRelease}
              className={cn(
                "anima-pip-no-drag absolute right-0 bottom-0 z-50 size-5 cursor-nwse-resize opacity-0 transition-opacity duration-150",
                isHovered && "opacity-100",
              )}
            >
              <span className="border-foreground/60 absolute right-1 bottom-1 size-2.5 rounded-br-sm border-r-2 border-b-2" />
            </div>
          ) : null}
        </div>
      </AnimaRouteProviders>
    </SettingsProvider>
  );
}
