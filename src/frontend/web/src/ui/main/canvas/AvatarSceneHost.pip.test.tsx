// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { AvatarSceneHost } from "@/ui/main/canvas/AvatarSceneHost";

const scene = vi.hoisted(() => ({
  /** Each distinct `onAvatarInstanceChange` the Scene received, in order. */
  avatarCallbacks: [] as Array<(avatar: Avatar | null) => void>,
}));

vi.mock("@/ui/main/canvas/Scene", () => ({
  default: ({
    onAvatarInstanceChange,
  }: {
    onAvatarInstanceChange: (avatar: Avatar | null) => void;
  }) => {
    const callbacks = scene.avatarCallbacks;
    if (callbacks.at(-1) !== onAvatarInstanceChange) {
      callbacks.push(onAvatarInstanceChange);
    }
    return null;
  },
}));
vi.mock("@/hooks/useElementSize", () => ({
  useElementSize: () => ({ width: 420, height: 560 }),
}));
vi.mock("@/hooks/useDesktopPipCursorLookAtInput", () => ({
  useDesktopPipCursorLookAtInput: () => null,
}));
vi.mock("@/hooks/useDesktopPipRuntimeSync", () => ({
  useDesktopPipRuntimeProducer: () => {},
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({ effectivePreferences: {}, userPreferences: {} }),
}));
vi.mock("@/ui/main/scene-vfx/SceneVFXLifecycleBridge", () => ({
  SceneVFXLifecycleBridge: () => null,
}));
vi.mock("@/ui/main/scene-vfx/SceneVFXOverlayHost", () => ({
  SceneVFXOverlayHost: () => null,
}));

/** An Avatar without bones, so framing falls back to the preset defaults. */
const avatar = {
  getCameraAnchorY: () => null,
  getHeadFramingScale: () => 1,
  getBodyFramingScale: () => 1,
  getHeadFramingCenter: () => 0,
} as unknown as Avatar;

describe("PiP Avatar framing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    scene.avatarCallbacks.length = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the Avatar callback stable when framing a loaded Avatar", () => {
    act(() => {
      root.render(<AvatarSceneHost mode="pip" pipCameraPreset="portrait" />);
    });
    expect(scene.avatarCallbacks).toHaveLength(1);

    // The loader reloads its Avatar whenever this callback changes, so a new
    // callback after framing would load, frame and reload without end.
    act(() => scene.avatarCallbacks[0](avatar));
    expect(scene.avatarCallbacks).toHaveLength(1);
  });
});
