// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsPreferences } from "@/lib/settings/preferences";
import { AvatarSceneHost } from "@/ui/main/canvas/AvatarSceneHost";
import type {
  SceneCameraPreset,
  SceneCameraSettings,
} from "@/ui/main/canvas/sceneCameraPresets";

const host = vi.hoisted(() => ({
  /** User preferences as read from the server; null until they load. */
  userPreferences: null as SettingsPreferences | null,
  updateUserPreferences: vi.fn(),
  sceneCameraSettings: null as SceneCameraSettings | null,
  /** The PiP preset the owner window last published to PiP. */
  publishedPipPreset: null as SceneCameraPreset | null,
  requestPipPreset: null as ((preset: SceneCameraPreset) => void) | null,
  /** The camera control rendered for each window; only PiP's has a title. */
  controls: new Map<
    string,
    {
      preset: SceneCameraPreset | null;
      onApplyPreset: (preset: SceneCameraPreset) => void;
    }
  >(),
}));

vi.mock("@/ui/main/canvas/Scene", () => ({
  default: ({
    sceneCameraSettings,
  }: {
    sceneCameraSettings: SceneCameraSettings;
  }) => {
    host.sceneCameraSettings = sceneCameraSettings;
    return null;
  },
}));
vi.mock("@/ui/main/canvas/SceneCameraPresetControl", () => ({
  SceneCameraPresetControl: (props: {
    title?: string;
    preset: SceneCameraPreset | null;
    onApplyPreset: (preset: SceneCameraPreset) => void;
  }) => {
    host.controls.set(props.title ? "pip" : "main", props);
    return null;
  },
}));
vi.mock("@/ui/main/canvas/SceneCameraPanel", () => ({
  SceneCameraPanel: () => null,
}));
vi.mock("@/hooks/useElementSize", () => ({
  useElementSize: () => ({ width: 800, height: 600 }),
}));
vi.mock("@/hooks/useDesktopPipCursorLookAtInput", () => ({
  useDesktopPipCursorLookAtInput: () => null,
}));
vi.mock("@/hooks/useDesktopPipRuntimeSync", () => ({
  useDesktopPipRuntimeProducer: (args: {
    cameraPreset: SceneCameraPreset;
    onCameraPresetRequest: (preset: SceneCameraPreset) => void;
  }) => {
    host.publishedPipPreset = args.cameraPreset;
    host.requestPipPreset = args.onCameraPresetRequest;
  },
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({
    effectivePreferences: host.userPreferences ?? {},
    userPreferences: host.userPreferences,
    updateUserPreferences: host.updateUserPreferences,
  }),
}));
vi.mock("@/ui/main/scene-vfx/SceneVFXLifecycleBridge", () => ({
  SceneVFXLifecycleBridge: () => null,
}));
vi.mock("@/ui/main/scene-vfx/SceneVFXOverlayHost", () => ({
  SceneVFXOverlayHost: () => null,
}));

describe("saved camera presets", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (isPipActive = false) => {
    act(() => {
      root.render(
        <AvatarSceneHost mode="main" isPipActive={isPipActive}>
          {({ cameraControls }) => cameraControls}
        </AvatarSceneHost>,
      );
    });
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host.userPreferences = null;
    host.updateUserPreferences.mockReset().mockResolvedValue(undefined);
    host.sceneCameraSettings = null;
    host.publishedPipPreset = null;
    host.requestPipPreset = null;
    host.controls.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("restores both windows' presets once preferences load", () => {
    render();
    expect(host.controls.get("main")?.preset).toBe("portrait");
    expect(host.publishedPipPreset).toBe("portrait-close");

    host.userPreferences = {
      presentation: {
        camera_preset: "full-body",
        pip_camera_preset: "portrait",
      },
    };
    render();

    expect(host.controls.get("main")?.preset).toBe("full-body");
    expect(host.sceneCameraSettings?.position.z).toBe(3.2);
    expect(host.publishedPipPreset).toBe("portrait");
    expect(host.updateUserPreferences).not.toHaveBeenCalled();
  });

  it("restores only once, keeping later choices over stale preferences", () => {
    host.userPreferences = { presentation: { camera_preset: "full-body" } };
    render();
    act(() => host.controls.get("main")?.onApplyPreset("portrait-close"));
    render();

    expect(host.controls.get("main")?.preset).toBe("portrait-close");
  });

  it("saves the main-window preset the owner picks", () => {
    host.userPreferences = {};
    render();
    act(() => host.controls.get("main")?.onApplyPreset("full-body-close"));

    expect(host.updateUserPreferences).toHaveBeenCalledWith({
      presentation: { camera_preset: "full-body-close" },
    });
  });

  it("saves the PiP preset picked in either window", () => {
    host.userPreferences = {};
    render(true);
    act(() => host.controls.get("pip")?.onApplyPreset("full-body"));
    act(() => host.requestPipPreset?.("portrait"));

    expect(host.updateUserPreferences.mock.calls).toEqual([
      [{ presentation: { pip_camera_preset: "full-body" } }],
      [{ presentation: { pip_camera_preset: "portrait" } }],
    ]);
    expect(host.publishedPipPreset).toBe("portrait");
  });
});
