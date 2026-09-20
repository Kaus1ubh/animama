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
import { useSceneCameraSettings } from "@/ui/settings/SceneCameraSettingsProvider";
import { SceneCameraPresetControl } from "@/ui/main/canvas/SceneCameraPresetControl";
import { SceneCameraPanel } from "@/ui/main/canvas/SceneCameraPanel";
import { type CanvasMode } from "@/ui/main/canvas/CanvasControls";
import {
  type SceneCameraBindings,
  buildSceneCameraPreset,
  type SceneCameraPreset,
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

// const DEFAULT_MAIN_SCENE_CAMERA_PRESET: SceneCameraPreset = "portrait";
const DEFAULT_MAIN_SCENE_CAMERA_PRESET: SceneCameraPreset = "full-body";
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
  sceneCameraSettingsOverride?: SceneCameraSettings | null;
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
  sceneCameraSettingsOverride = null,
  suspendSceneRender = false,
}: AvatarSceneHostProps) {
  const [canvasHostElement, setCanvasHostElement] =
    useState<HTMLDivElement | null>(null);
  const [sceneAvatar, setSceneAvatar] = useState<Avatar | null>(null);
  const [avatarTransform, setAvatarTransform] = useState<AvatarTransform>(() =>
    cloneAvatarTransform(DEFAULT_AVATAR_TRANSFORM),
  );
  const appCameraSettings = useSceneCameraSettings();
  const setAppCameraPanel = appCameraSettings?.setPanel;
  const [selectedCameraPreset, setSelectedCameraPreset] =
    useState<SceneCameraPreset | null>(DEFAULT_MAIN_SCENE_CAMERA_PRESET);
  const [sceneCameraSettings, setSceneCameraSettings] =
    useState<SceneCameraSettings>(() => getDefaultSceneCameraPreset().settings);
  const [sceneCameraBindings, setSceneCameraBindings] =
    useState<SceneCameraBindings>(() => getDefaultSceneCameraPreset().bindings);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [transformMode, setTransformMode] = useState<TransformMode | null>(
    null,
  );
  const [uniformScaleLocked, setUniformScaleLocked] = useState(true);
  const avatarRuntimeRef = useRef<Avatar | null>(null);
  const { effectivePreferences, userPreferences } = useSettings();
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
  const handleSceneCameraReset = useCallback(() => {
    setSelectedCameraPreset(DEFAULT_MAIN_SCENE_CAMERA_PRESET);
    const nextPreset = buildSceneCameraPreset(
      DEFAULT_MAIN_SCENE_CAMERA_PRESET,
      {
        avatar: avatarRuntimeRef.current,
        fallbackSettings: sceneCameraSettings,
      },
    );
    setSceneCameraSettings(nextPreset.settings);
    setSceneCameraBindings(nextPreset.bindings);
  }, [sceneCameraSettings]);
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
  const handleAvatarInstanceChange = useCallback(
    (avatar: Avatar | null) => {
      avatarRuntimeRef.current = avatar;
      setSceneAvatar(avatar);
      if (!avatar) return;

      setSceneCameraSettings((current) =>
        sampleSceneCameraBindings(current, sceneCameraBindings, avatar),
      );
    },
    [sceneCameraBindings],
  );
  const handleSceneCameraPresetApply = useCallback(
    (preset: SceneCameraPreset) => {
      setSelectedCameraPreset(preset);
      const avatar = avatarRuntimeRef.current;
      const nextPreset = buildSceneCameraPreset(preset, {
        avatar,
        fallbackSettings: sceneCameraSettings,
      });

      setSceneCameraSettings(nextPreset.settings);
      setSceneCameraBindings(nextPreset.bindings);
    },
    [sceneCameraSettings],
  );

  const isMainSceneRenderSuspended =
    mode === "main" && suspendSceneRender === true;
  const showScene =
    mode === "pip" ||
    (!isMainSceneRenderSuspended && (canvasMode !== "chat" || isPipActive));
  const fullCameraPanel = useMemo(
    () =>
      mode === "main" && showScene && !isPipActive ? (
        <SceneCameraPanel
          bindings={sceneCameraBindings}
          settings={sceneCameraSettings}
          onApplyPreset={handleSceneCameraPresetApply}
          onOrbitTargetYBoneChange={handleSceneCameraOrbitTargetYBoneChange}
          onFovChange={handleSceneCameraFovChange}
          onPositionChange={handleSceneCameraPositionChange}
          onPositionYBoneChange={handleSceneCameraPositionYBoneChange}
          onReset={handleSceneCameraReset}
          onTargetChange={handleSceneCameraTargetChange}
        />
      ) : null,
    [
      mode,
      showScene,
      isPipActive,
      sceneCameraBindings,
      sceneCameraSettings,
      handleSceneCameraPresetApply,
      handleSceneCameraOrbitTargetYBoneChange,
      handleSceneCameraFovChange,
      handleSceneCameraPositionChange,
      handleSceneCameraPositionYBoneChange,
      handleSceneCameraReset,
      handleSceneCameraTargetChange,
    ],
  );

  // Keep the scene as camera owner and remove the settings slot when it unmounts.
  useEffect(() => {
    if (mode !== "main" || !setAppCameraPanel) return;
    setAppCameraPanel(fullCameraPanel);
    return () => setAppCameraPanel(null);
  }, [mode, fullCameraPanel, setAppCameraPanel]);

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
    enabled: mode === "main",
    sceneCameraSettings,
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
    if (mode !== "pip" || !sceneCameraSettingsOverride) return;
    setSceneCameraSettings(sceneCameraSettingsOverride);
  }, [mode, sceneCameraSettingsOverride]);

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
              mode === "main" && showScene && !isPipActive ? (
                <SceneCameraPresetControl
                  preset={selectedCameraPreset}
                  onApplyPreset={handleSceneCameraPresetApply}
                />
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
