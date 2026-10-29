"use client";

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { MathUtils } from "three";

import { useElementSize } from "@/hooks/useElementSize";
import { useDesktopPipCursorLookAtInput } from "@/hooks/useDesktopPipCursorLookAtInput";
import { useDesktopPipRuntimeProducer } from "@/hooks/useDesktopPipRuntimeSync";
import type { Avatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { DEBUG_ENABLED } from "@/platform/env";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { useSceneVFXStore } from "@/stores/scene-vfx-store";
import { SceneVFXLifecycleBridge } from "@/ui/main/scene-vfx/SceneVFXLifecycleBridge";
import { SceneVFXOverlayHost } from "@/ui/main/scene-vfx/SceneVFXOverlayHost";
import { CanvasViewportProvider } from "@/ui/main/canvas/CanvasViewportContext";
import { SceneRuntimeProvider } from "@/ui/main/canvas/SceneRuntimeContext";
import Scene from "@/ui/main/canvas/Scene";
import { SceneCameraPresetControl } from "@/ui/main/canvas/SceneCameraPresetControl";
import { SceneCameraPanel } from "@/ui/main/canvas/SceneCameraPanel";
import { type CanvasMode } from "@/ui/main/canvas/CanvasControls";
import {
  type SceneCameraBindings,
  buildSceneCameraPreset,
  DEFAULT_PIP_SCENE_CAMERA_PRESET,
  readSavedSceneCameraPreset,
  savedSceneCameraPresetPatch,
  type SceneCameraPreset,
  type SceneCameraPresetWindow,
  type SceneCameraSettings,
  type SceneCameraYBoneBinding,
  type SceneVector3,
} from "@/ui/main/canvas/sceneCameraPresets";
import {
  areAvatarTransformsEqual,
  cloneAvatarTransform,
  DEFAULT_AVATAR_TRANSFORM,
  isUniformScale,
  type AvatarTransform,
  type TransformAxis,
  type TransformMode,
} from "@/ui/main/canvas/transform-state";
import { TransformPanel } from "@/ui/main/canvas/TransformPanel";

const DEFAULT_MAIN_SCENE_CAMERA_PRESET: SceneCameraPreset = "portrait";
const LazyAnimaDebugPanel =
  __ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED
    ? lazy(() => import("@/ui/debug/SceneDebugPanel"))
    : null;

export type AvatarSceneHostMode = "main" | "pip";

export type AvatarSceneHostRenderState = {
  cameraControls: ReactNode;
  overlayPassthroughActive: boolean;
  showScene: boolean;
};

type AvatarSceneHostProps = {
  backgroundMode?: DesktopPipBackgroundMode;
  avatarTransformOverride?: AvatarTransform | null;
  canvasHostRef?: MutableRefObject<HTMLDivElement | null>;
  canvasMode?: CanvasMode;
  canvasWrapperElement?: HTMLElement | null;
  children?: (state: AvatarSceneHostRenderState) => ReactNode;
  className?: string;
  isPipActive?: boolean;
  mode: AvatarSceneHostMode;
  /** PiP only: the owner's PiP camera preset, framed on this Avatar. */
  pipCameraPreset?: SceneCameraPreset;
  suspendSceneRender?: boolean;
};

function getDefaultSceneCameraPreset() {
  return buildSceneCameraPreset(DEFAULT_MAIN_SCENE_CAMERA_PRESET);
}

function sampleSceneCameraBindings(
  settings: SceneCameraSettings,
  bindings: SceneCameraBindings,
  avatar: Avatar | null,
): SceneCameraSettings {
  if (!avatar) return settings;

  const nextSettings: SceneCameraSettings = {
    position: { ...settings.position },
    fov: settings.fov,
    orbitTarget: { ...settings.orbitTarget },
  };

  if (bindings.positionYBone !== "manual") {
    const nextY = avatar.getCameraAnchorY(bindings.positionYBone);
    if (typeof nextY === "number") {
      nextSettings.position.y = nextY + bindings.positionYOffset;
    }
  }

  if (bindings.orbitTargetYBone !== "manual") {
    const nextY = avatar.getCameraAnchorY(bindings.orbitTargetYBone);
    if (typeof nextY === "number") {
      nextSettings.orbitTarget.y = nextY + bindings.orbitTargetYOffset;
    }
  }

  return nextSettings;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  return Boolean(
    target.closest(
      '[contenteditable="true"], [contenteditable="plaintext-only"]',
    ),
  );
}

function SceneHostLayer({
  hostRef,
  children,
}: {
  hostRef: (node: HTMLDivElement | null) => void;
  children?: ReactNode;
}) {
  const underlayCoverUiOverlaysActive = useSceneVFXStore(
    (state) => state.underlayCoverUiOverlaysActive,
  );

  return (
    <div
      ref={hostRef}
      className={cn(
        "h-full w-full",
        underlayCoverUiOverlaysActive && "relative z-40",
      )}
    >
      {children}
    </div>
  );
}

export function AvatarSceneHost({
  backgroundMode = "scene",
  avatarTransformOverride = null,
  canvasHostRef,
  canvasMode = "avatar-chat",
  canvasWrapperElement = null,
  children,
  className,
  isPipActive = false,
  mode,
  pipCameraPreset: pipCameraPresetOverride = DEFAULT_PIP_SCENE_CAMERA_PRESET,
  suspendSceneRender = false,
}: AvatarSceneHostProps) {
  const { t } = useTranslation("chat");
  const [canvasHostElement, setCanvasHostElement] =
    useState<HTMLDivElement | null>(null);
  const [sceneAvatar, setSceneAvatar] = useState<Avatar | null>(null);
  const [avatarTransform, setAvatarTransform] = useState<AvatarTransform>(() =>
    cloneAvatarTransform(DEFAULT_AVATAR_TRANSFORM),
  );
  const [selectedCameraPreset, setSelectedCameraPreset] =
    useState<SceneCameraPreset | null>(DEFAULT_MAIN_SCENE_CAMERA_PRESET);
  const [sceneCameraSettings, setSceneCameraSettings] =
    useState<SceneCameraSettings>(() => getDefaultSceneCameraPreset().settings);
  const [sceneCameraBindings, setSceneCameraBindings] =
    useState<SceneCameraBindings>(() => getDefaultSceneCameraPreset().bindings);
  // The owner chooses PiP's preset separately from its own camera.
  const [pipCameraPreset, setPipCameraPreset] = useState<SceneCameraPreset>(
    DEFAULT_PIP_SCENE_CAMERA_PRESET,
  );
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [transformMode, setTransformMode] = useState<TransformMode | null>(
    null,
  );
  const [uniformScaleLocked, setUniformScaleLocked] = useState(true);
  const avatarRuntimeRef = useRef<Avatar | null>(null);
  const { effectivePreferences, updateUserPreferences, userPreferences } =
    useSettings();
  const canvasSize = useElementSize(canvasHostElement, isPipActive);
  const animaDebugPanelEnabled = mode === "main" && DEBUG_ENABLED;
  const cursorLookAtInputProvider = useDesktopPipCursorLookAtInput(
    mode === "pip",
  );
  const clearAllSceneVFX = useSceneVFXStore((state) => state.clearAllSceneVFX);
  const avatarTransformControlsEnabled =
    mode === "main" &&
    userPreferences?.presentation?.enable_avatar_transform_controls === true;
  const clipVfxEnabled =
    effectivePreferences.presentation?.disable_vfx !== true;
  const canvasViewport = useMemo(() => {
    const hasSize = canvasSize.width > 0 && canvasSize.height > 0;
    return {
      width: canvasSize.width,
      height: canvasSize.height,
      aspectRatio: hasSize ? canvasSize.width / canvasSize.height : 16 / 9,
      hasSize,
    };
  }, [canvasSize.height, canvasSize.width]);
  const sceneRuntimeValue = useMemo(
    () => ({
      avatar: sceneAvatar,
    }),
    [sceneAvatar],
  );

  const handleCanvasHostRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (canvasHostRef) {
        canvasHostRef.current = node;
      }
      setCanvasHostElement(node);
    },
    [canvasHostRef],
  );
  const handleAvatarTransformChange = useCallback(
    (nextTransform: AvatarTransform) => {
      setAvatarTransform((current) =>
        areAvatarTransformsEqual(current, nextTransform)
          ? current
          : cloneAvatarTransform(nextTransform),
      );
      if (uniformScaleLocked && !isUniformScale(nextTransform.scale)) {
        setUniformScaleLocked(false);
      }
    },
    [uniformScaleLocked],
  );
  const handlePositionChange = useCallback(
    (axis: TransformAxis, value: number) => {
      setAvatarTransform((current) => {
        const nextTransform = cloneAvatarTransform(current);
        nextTransform.position[axis] = value;
        return areAvatarTransformsEqual(current, nextTransform)
          ? current
          : nextTransform;
      });
    },
    [],
  );
  const handleRotationChangeDegrees = useCallback(
    (axis: TransformAxis, value: number) => {
      const nextRadians = MathUtils.degToRad(value);
      setAvatarTransform((current) => {
        const nextTransform = cloneAvatarTransform(current);
        nextTransform.rotation[axis] = nextRadians;
        return areAvatarTransformsEqual(current, nextTransform)
          ? current
          : nextTransform;
      });
    },
    [],
  );
  const handleScaleChange = useCallback(
    (axis: TransformAxis, value: number) => {
      const nextScaleValue = Math.max(0.001, value);
      setAvatarTransform((current) => {
        const nextTransform = cloneAvatarTransform(current);
        if (uniformScaleLocked) {
          nextTransform.scale = {
            x: nextScaleValue,
            y: nextScaleValue,
            z: nextScaleValue,
          };
        } else {
          nextTransform.scale[axis] = nextScaleValue;
        }
        return areAvatarTransformsEqual(current, nextTransform)
          ? current
          : nextTransform;
      });
    },
    [uniformScaleLocked],
  );
  const handleUniformScaleLockedChange = useCallback((checked: boolean) => {
    setUniformScaleLocked(checked);
    if (!checked) return;

    setAvatarTransform((current) => {
      const uniformScaleValue =
        (current.scale.x + current.scale.y + current.scale.z) / 3;
      const nextTransform = cloneAvatarTransform(current);
      nextTransform.scale = {
        x: uniformScaleValue,
        y: uniformScaleValue,
        z: uniformScaleValue,
      };
      return areAvatarTransformsEqual(current, nextTransform)
        ? current
        : nextTransform;
    });
  }, []);
  const handleSceneCameraPositionChange = useCallback(
    (axis: keyof SceneVector3, value: number) => {
      setSelectedCameraPreset(null);
      setSceneCameraSettings((current) => ({
        ...current,
        position: {
          ...current.position,
          [axis]: value,
        },
      }));
    },
    [],
  );
  const handleSceneCameraTargetChange = useCallback(
    (axis: keyof SceneVector3, value: number) => {
      setSelectedCameraPreset(null);
      setSceneCameraSettings((current) => ({
        ...current,
        orbitTarget: {
          ...current.orbitTarget,
          [axis]: value,
        },
      }));
    },
    [],
  );
  const handleSceneCameraFovChange = useCallback((value: number) => {
    setSelectedCameraPreset(null);
    setSceneCameraSettings((current) => ({
      ...current,
      fov: MathUtils.clamp(value, 10, 90),
    }));
  }, []);
  const handleSceneCameraPositionYBoneChange = useCallback(
    (value: SceneCameraYBoneBinding) => {
      setSelectedCameraPreset(null);
      if (value !== "manual") {
        const nextY = avatarRuntimeRef.current?.getCameraAnchorY(value);
        if (typeof nextY === "number") {
          setSceneCameraSettings((current) => ({
            ...current,
            position: {
              ...current.position,
              y: nextY,
            },
          }));
        }
      }

      setSceneCameraBindings((current) =>
        current.positionYBone === value
          ? current
          : {
              ...current,
              positionYBone: value,
              positionYOffset: 0,
            },
      );
    },
    [],
  );
  const handleSceneCameraOrbitTargetYBoneChange = useCallback(
    (value: SceneCameraYBoneBinding) => {
      setSelectedCameraPreset(null);
      if (value !== "manual") {
        const nextY = avatarRuntimeRef.current?.getCameraAnchorY(value);
        if (typeof nextY === "number") {
          setSceneCameraSettings((current) => ({
            ...current,
            orbitTarget: {
              ...current.orbitTarget,
              y: nextY,
            },
          }));
        }
      }

      setSceneCameraBindings((current) =>
        current.orbitTargetYBone === value
          ? current
          : {
              ...current,
              orbitTargetYBone: value,
              orbitTargetYOffset: 0,
            },
      );
    },
    [],
  );
  // The Avatar loader reloads its Avatar whenever this callback changes, so
  // it reads the bindings through a ref: framing an Avatar replaces them.
  const sceneCameraBindingsRef = useRef(sceneCameraBindings);
  useEffect(() => {
    sceneCameraBindingsRef.current = sceneCameraBindings;
  }, [sceneCameraBindings]);
  const selectedCameraPresetRef = useRef(selectedCameraPreset);
  useEffect(() => {
    selectedCameraPresetRef.current = selectedCameraPreset;
  }, [selectedCameraPreset]);
  const sceneCameraSettingsRef = useRef(sceneCameraSettings);
  useEffect(() => {
    sceneCameraSettingsRef.current = sceneCameraSettings;
  }, [sceneCameraSettings]);
  const handleAvatarInstanceChange = useCallback(
    (avatar: Avatar | null) => {
      avatarRuntimeRef.current = avatar;
      setSceneAvatar(avatar);
      // PiP frames each new Avatar from its preset below.
      if (!avatar || mode === "pip") return;

      // A chosen preset frames the new Avatar afresh: a big head moves the
      // camera back as well as to its head (`buildSceneCameraPreset`).
      const preset = selectedCameraPresetRef.current;
      if (preset) {
        // Without a head bone the current height stays, as when sampling.
        const nextPreset = buildSceneCameraPreset(preset, {
          avatar,
          fallbackSettings: sceneCameraSettingsRef.current,
        });
        setSceneCameraSettings(nextPreset.settings);
        setSceneCameraBindings(nextPreset.bindings);
        return;
      }
      setSceneCameraSettings((current) =>
        sampleSceneCameraBindings(
          current,
          sceneCameraBindingsRef.current,
          avatar,
        ),
      );
    },
    [mode],
  );
  /** Frames the current Avatar with a main-window preset. */
  const applySceneCameraPreset = useCallback((preset: SceneCameraPreset) => {
    setSelectedCameraPreset(preset);
    const nextPreset = buildSceneCameraPreset(preset, {
      avatar: avatarRuntimeRef.current,
      fallbackSettings: sceneCameraSettingsRef.current,
    });
    setSceneCameraSettings(nextPreset.settings);
    setSceneCameraBindings(nextPreset.bindings);
  }, []);

  // Both windows' presets are installation-wide user preferences. They are
  // restored once, when preferences first load; a preset the owner picks
  // before then wins, as does every later pick over a stale cache.
  const savedCameraPresetsSettledRef = useRef(false);
  useEffect(() => {
    if (
      mode !== "main" ||
      !userPreferences ||
      savedCameraPresetsSettledRef.current
    ) {
      return;
    }
    savedCameraPresetsSettledRef.current = true;
    const mainPreset = readSavedSceneCameraPreset(userPreferences, "main");
    if (mainPreset) applySceneCameraPreset(mainPreset);
    const savedPipPreset = readSavedSceneCameraPreset(userPreferences, "pip");
    if (savedPipPreset) setPipCameraPreset(savedPipPreset);
  }, [applySceneCameraPreset, mode, userPreferences]);
  const saveCameraPreset = useCallback(
    (target: SceneCameraPresetWindow, preset: SceneCameraPreset) => {
      savedCameraPresetsSettledRef.current = true;
      // A failed save is logged by the provider; the preset still applies
      // for this session.
      void updateUserPreferences(
        savedSceneCameraPresetPatch(target, preset),
      ).catch(() => {});
    },
    [updateUserPreferences],
  );
  const handleSceneCameraPresetApply = useCallback(
    (preset: SceneCameraPreset) => {
      applySceneCameraPreset(preset);
      saveCameraPreset("main", preset);
    },
    [applySceneCameraPreset, saveCameraPreset],
  );
  const handleSceneCameraReset = useCallback(() => {
    handleSceneCameraPresetApply(DEFAULT_MAIN_SCENE_CAMERA_PRESET);
  }, [handleSceneCameraPresetApply]);
  const handlePipCameraPresetApply = useCallback(
    (preset: SceneCameraPreset) => {
      setPipCameraPreset(preset);
      saveCameraPreset("pip", preset);
    },
    [saveCameraPreset],
  );

  const isMainSceneRenderSuspended =
    mode === "main" && suspendSceneRender === true;
  const showScene =
    mode === "pip" ||
    (!isMainSceneRenderSuspended && (canvasMode !== "chat" || isPipActive));
  const transformModeAvailable =
    mode === "main" &&
    showScene &&
    !isPipActive &&
    avatarTransformControlsEnabled;
  const orbitModifierActive =
    mode === "main" &&
    canvasMode === "avatar-chat" &&
    showScene &&
    !isPipActive &&
    avatarTransformControlsEnabled &&
    isCtrlPressed;
  const activeTransformMode = transformModeAvailable ? transformMode : null;
  const overlayPassthroughActive =
    orbitModifierActive || activeTransformMode !== null;
  const orbitInteractionEnabled =
    mode === "main" &&
    avatarTransformControlsEnabled &&
    showScene &&
    (canvasMode === "avatar" || isPipActive || orbitModifierActive);
  const transparentBackground =
    mode === "pip" && backgroundMode === "transparent";

  useDesktopPipRuntimeProducer({
    avatarTransform,
    backgroundMode,
    cameraPreset: pipCameraPreset,
    enabled: mode === "main",
    onCameraPresetRequest: handlePipCameraPresetApply,
  });

  useEffect(() => {
    if (mode !== "pip" || !avatarTransformOverride) return;
    setAvatarTransform((current) =>
      areAvatarTransformsEqual(current, avatarTransformOverride)
        ? current
        : cloneAvatarTransform(avatarTransformOverride),
    );
  }, [avatarTransformOverride, mode]);

  useEffect(() => {
    if (mode !== "pip") return;
    const nextPreset = buildSceneCameraPreset(pipCameraPresetOverride, {
      avatar: sceneAvatar,
    });
    setSceneCameraSettings(nextPreset.settings);
    setSceneCameraBindings(nextPreset.bindings);
  }, [mode, pipCameraPresetOverride, sceneAvatar]);

  useEffect(() => {
    if (showScene || isMainSceneRenderSuspended) return;
    clearAllSceneVFX();
  }, [clearAllSceneVFX, isMainSceneRenderSuspended, showScene]);

  useEffect(() => {
    if (avatarTransformControlsEnabled) return;
    if (transformMode === null && !isCtrlPressed) return;

    const timeout = window.setTimeout(() => {
      setTransformMode(null);
      setIsCtrlPressed(false);
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [avatarTransformControlsEnabled, isCtrlPressed, transformMode]);

  useEffect(() => {
    if (mode !== "main") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      setIsCtrlPressed(event.ctrlKey);
      const key = event.key.toLowerCase();

      if (
        !event.repeat &&
        (key === "g" || key === "r" || key === "s") &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.ctrlKey &&
        transformModeAvailable &&
        !isEditableKeyboardTarget(event.target)
      ) {
        event.preventDefault();
        const requestedMode: TransformMode =
          key === "g" ? "translate" : key === "r" ? "rotate" : "scale";
        setTransformMode((current) =>
          current === requestedMode ? null : requestedMode,
        );
        return;
      }

      if (event.key === "Escape") {
        setTransformMode(null);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      setIsCtrlPressed(event.ctrlKey);
    };
    const clearCtrlModifier = () => {
      setIsCtrlPressed(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearCtrlModifier();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearCtrlModifier);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearCtrlModifier);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [mode, transformModeAvailable]);

  useEffect(() => {
    if (mode !== "main") return;
    const wrapper = canvasWrapperElement;
    if (!wrapper) return;

    const handleWheel = (event: WheelEvent) => {
      if (!orbitModifierActive || !event.ctrlKey) return;
      event.preventDefault();
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!orbitModifierActive || !event.ctrlKey) return;
      event.preventDefault();
    };

    wrapper.addEventListener("wheel", handleWheel, { passive: false });
    wrapper.addEventListener("contextmenu", handleContextMenu);

    return () => {
      wrapper.removeEventListener("wheel", handleWheel);
      wrapper.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [canvasWrapperElement, mode, orbitModifierActive]);

  return (
    <CanvasViewportProvider value={canvasViewport}>
      <SceneRuntimeProvider value={sceneRuntimeValue}>
        <SceneVFXLifecycleBridge />
        <div className={cn("absolute inset-0", className)}>
          <SceneHostLayer hostRef={handleCanvasHostRef}>
            {showScene ? (
              <Scene
                allowBackgroundLayers={!transparentBackground}
                avatarTransform={avatarTransform}
                clipVfxEnabled={clipVfxEnabled}
                cursorLookAtInputProvider={cursorLookAtInputProvider}
                orbitInteractionEnabled={orbitInteractionEnabled}
                orbitModifierActive={orbitModifierActive}
                onAvatarInstanceChange={handleAvatarInstanceChange}
                onAvatarTransformChange={handleAvatarTransformChange}
                playRuntimeVfxSounds={mode === "main"}
                measureLilToonGpu={mode === "main"}
                sceneCameraSettings={sceneCameraSettings}
                transformMode={activeTransformMode}
                transparentBackground={transparentBackground}
                orbitDomElement={
                  orbitModifierActive ? canvasWrapperElement : null
                }
                transformDomElement={
                  activeTransformMode ? canvasWrapperElement : null
                }
              />
            ) : null}
          </SceneHostLayer>
          {showScene ? <SceneVFXOverlayHost /> : null}
          {children?.({
            overlayPassthroughActive,
            showScene,
            cameraControls:
              mode === "main" && isPipActive ? (
                <SceneCameraPresetControl
                  title={t("canvas.camera.pipTitle")}
                  preset={pipCameraPreset}
                  onApplyPreset={handlePipCameraPresetApply}
                />
              ) : mode === "main" && showScene ? (
                <div className="space-y-3">
                  <SceneCameraPresetControl
                    preset={selectedCameraPreset}
                    onApplyPreset={handleSceneCameraPresetApply}
                  />
                  <details className="group">
                    <summary className="focus-visible:ring-ring cursor-pointer rounded-sm text-sm outline-none focus-visible:ring-2">
                      {t("canvas.camera.fineTune")}
                    </summary>
                    <SceneCameraPanel
                      className="mt-3"
                      bindings={sceneCameraBindings}
                      settings={sceneCameraSettings}
                      onOrbitTargetYBoneChange={
                        handleSceneCameraOrbitTargetYBoneChange
                      }
                      onFovChange={handleSceneCameraFovChange}
                      onPositionChange={handleSceneCameraPositionChange}
                      onPositionYBoneChange={
                        handleSceneCameraPositionYBoneChange
                      }
                      onReset={handleSceneCameraReset}
                      onTargetChange={handleSceneCameraTargetChange}
                    />
                  </details>
                </div>
              ) : null,
          })}
          {animaDebugPanelEnabled && LazyAnimaDebugPanel ? (
            <Suspense fallback={null}>
              <LazyAnimaDebugPanel />
            </Suspense>
          ) : null}
          {mode === "main" && activeTransformMode ? (
            <TransformPanel
              mode={activeTransformMode}
              transform={avatarTransform}
              uniformScaleLocked={uniformScaleLocked}
              onPositionChange={handlePositionChange}
              onRotationChangeDegrees={handleRotationChangeDegrees}
              onScaleChange={handleScaleChange}
              onUniformScaleLockedChange={handleUniformScaleLockedChange}
            />
          ) : null}
        </div>
      </SceneRuntimeProvider>
    </CanvasViewportProvider>
  );
}
