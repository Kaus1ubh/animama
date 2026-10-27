// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeAvatarLoads,
  fakeAvatars,
  fakeSettingsItemIds,
  resetFakeSettingsAvatars,
  setFakeSettings,
} from "@/lib/avatar/testing/fakeSettingsAvatar";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import { PoseCreatorAvatarActor } from "./PoseCreatorAvatarActor";

vi.mock("@/lib/avatar", async () => ({
  Avatar: (await import("@/lib/avatar/testing/fakeSettingsAvatar"))
    .FakeSettingsAvatar,
}));
vi.mock("@/query/hooks/useAvatarSettings", async () => ({
  useAvatarLoadSettings: (
    await import("@/lib/avatar/testing/fakeSettingsAvatar")
  ).fakeUseAvatarLoadSettings,
}));
vi.mock("@react-three/fiber", () => ({
  useThree: () => three,
  useFrame: () => undefined,
}));
// Pose authoring and the humanoid tools are not under test here.
vi.mock("./poseCreatorAuthoring", () => ({
  applyPoseCreatorBasePose: () => undefined,
  applyPoseCreatorDraftsToAvatar: () => undefined,
}));
vi.mock("./PoseCreatorBoneGizmo", () => ({ PoseCreatorBoneGizmo: () => null }));
vi.mock("./PoseCreatorBoneMarkers", () => ({
  PoseCreatorBoneMarkers: () => null,
}));
vi.mock("./PoseCreatorClipPlaybackTicker", () => ({
  PoseCreatorClipPlaybackTicker: () => null,
}));
vi.mock("@/lib/runtime-content/runtimeContentDelivery", () => ({
  runtimeContentDeliveryUrl: () => "/avatar.vrm",
  runtimeContentDownloadUrl: async () => ({
    url: "blob:avatar",
    release: () => undefined,
  }),
}));

const three = { camera: {}, gl: { domElement: {} } };

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const entry = {
  runtime_id: "avatar",
  content_revision: "revision-1",
  config: { avatar_catalog_item_id: "avatar-1" },
  source: { type: "public_url", url: "/avatar.vrm" },
} as unknown as RuntimeCatalogEntry;

let root: Root;

async function settings(springMode: string, materialMode: string | null) {
  setFakeSettings(springMode, materialMode);
  await act(async () =>
    root.render(<PoseCreatorAvatarActor entry={entry} catalog={null} />),
  );
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

describe("PoseCreatorAvatarActor Avatar settings", () => {
  it("loads with the settings, changes the wind live and reloads for materials", async () => {
    await settings("automatic", null);
    expect(fakeAvatars).toHaveLength(0);

    await settings("springs_off", "simple");
    expect(new Set(fakeSettingsItemIds)).toEqual(new Set(["avatar-1"]));
    expect(fakeAvatarLoads(0)).toEqual(["load springs_off simple"]);
    await act(async () => fakeAvatars[0]!.finishLoad());

    await settings("on", "simple");
    expect(fakeAvatars).toHaveLength(1);
    expect(fakeAvatarLoads(0)).toHaveLength(1);
    expect(fakeAvatars[0]!.events.at(-1)).toBe("wind on");

    await settings("on", "automatic");
    expect(fakeAvatars).toHaveLength(2);
    expect(fakeAvatars[0]!.disposed).toBe(true);
    expect(fakeAvatarLoads(1)).toEqual(["load on automatic"]);
  });
});
