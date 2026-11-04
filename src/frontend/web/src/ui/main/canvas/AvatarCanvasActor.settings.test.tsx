// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeAvatars,
  fakeSettingsItemIds,
  resetFakeSettingsAvatars,
  setFakeSettings,
} from "@/lib/avatar/testing/fakeSettingsAvatar";
import { AvatarCanvasActor } from "./AvatarCanvasActor";

const harness = vi.hoisted(() => ({
  runtime: {
    data: {
      effective_revision: "revision-1",
      avatar_model: {
        runtime_id: "avatar",
        config: { avatar_catalog_item_id: "avatar-1" },
        source: { type: "public_url", url: "/avatar.vrm" },
      },
    },
    catalog: { subscribe: () => () => undefined },
    isPending: false,
    playbackStatus: "ready",
    finishAvatarPreparation: () => undefined,
  },
  three: { gl: { domElement: {} }, camera: {}, scene: {} },
}));

vi.mock("@/lib/avatar", async () => ({
  hasBlockingNonTtsPresentationWork: () => false,
  Avatar: (await import("@/lib/avatar/testing/fakeSettingsAvatar"))
    .FakeSettingsAvatar,
}));
vi.mock("@react-three/fiber", () => ({
  useThree: () => harness.three,
  useFrame: () => undefined,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ animaId: "anima-1" }),
}));
vi.mock("@/ui/app/AnimaRouteProviders", () => ({
  useMountedAnimaRuntimeContent: () => harness.runtime,
}));
vi.mock("@/hooks/useSoundController", () => ({
  useOptionalSoundController: () => null,
}));
vi.mock("@/lib/runtime-content/animaRuntimeSnapshot", () => ({
  runtimeContentEntryLoadKey: () => "avatar-key",
}));
vi.mock("@/lib/runtime-content/runtimeContentDelivery", () => ({
  runtimeContentDeliveryUrl: () => "/avatar.vrm",
  runtimeContentDownloadUrl: async () => ({
    url: "blob:avatar",
    release: () => undefined,
  }),
  preparedRuntimeResourceUrls: () => undefined,
}));
vi.mock("./firstPosedFrame", () => ({
  observeFirstPosedFrame: () => ({ rendered: false, dispose: () => {} }),
}));
vi.mock("@/query/hooks/useAvatarSettings", async () => ({
  useAvatarLoadSettings: (
    await import("@/lib/avatar/testing/fakeSettingsAvatar")
  ).fakeUseAvatarLoadSettings,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

async function settings(springMode: string, materialMode: string | null) {
  setFakeSettings(springMode, materialMode);
  await act(async () => root.render(<AvatarCanvasActor />));
}

beforeEach(() => {
  resetFakeSettingsAvatars();
  vi.spyOn(console, "info").mockImplementation(() => {});
  // react-dom does not know R3F's <primitive>.
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

describe("AvatarCanvasActor Avatar settings", () => {
  it("loads with the settings and changes the wind live, without a new Avatar", async () => {
    await settings("springs_off", "simple");
    expect(new Set(fakeSettingsItemIds)).toEqual(new Set(["avatar-1"]));
    expect(fakeAvatars).toHaveLength(1);
    await act(async () => fakeAvatars[0]!.finishLoad());
    expect(fakeAvatars[0]!.events[0]).toBe("load springs_off simple");

    await settings("on", "simple");
    expect(fakeAvatars).toHaveLength(1);
    expect(fakeAvatars[0]!.disposed).toBe(false);
    expect(fakeAvatars[0]!.events.at(-1)).toBe("wind on");
    expect(
      fakeAvatars[0]!.events.filter((event) => event.startsWith("load")),
    ).toHaveLength(1);
  });

  it("waits for the material setting, then reloads when it changes", async () => {
    await settings("automatic", null);
    expect(fakeAvatars).toHaveLength(0);

    await settings("automatic", "automatic");
    expect(fakeAvatars).toHaveLength(1);
    await act(async () => fakeAvatars[0]!.finishLoad());

    await settings("automatic", "simple");
    expect(fakeAvatars).toHaveLength(2);
    expect(fakeAvatars[0]!.disposed).toBe(true);
    expect(fakeAvatars[1]!.events[0]).toBe("load automatic simple");
  });

  it("applies a wind change made while the Avatar loads once it is ready", async () => {
    await settings("automatic", "automatic");
    expect(fakeAvatars[0]!.events).toEqual(["load automatic automatic"]);

    await settings("off", "automatic");
    await act(async () => fakeAvatars[0]!.finishLoad());
    expect(fakeAvatars).toHaveLength(1);
    expect(fakeAvatars[0]!.events.at(-1)).toBe("wind off");
  });
});
