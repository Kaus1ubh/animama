// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeAvatarLoads,
  fakeAvatars,
  fakeSettingsItemIds,
  resetFakeSettingsAvatars,
  setFakeSettings,
} from "@/lib/avatar/testing/fakeSettingsAvatar";
import { CreateAnimaStage } from "./CreateAnimaStage";
import { ref } from "./createAnimaTestFixtures";

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
vi.mock("motion/react", () => ({ useReducedMotion: () => false }));
vi.mock("@/ui/avatar-preview/AvatarPreviewSurface", () => ({
  AvatarPreviewSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./CreateAnimaPreviewSession", () => ({
  CreateAnimaPreviewSession: class {
    catalog = {};
    stop() {}
    dispose() {}
    bind() {
      return () => undefined;
    }
  },
}));
vi.mock("./createAnimaPortrait", () => ({
  useCreationPortraitCapture: () => undefined,
}));
vi.mock("@/query/hooks/useAvatarFaceParts", () => ({
  useAvatarFaceParts: () => ({ data: undefined }),
}));
vi.mock("@/lib/runtime-content/VerifiedByteLoader", () => ({
  VerifiedByteLoader: class {
    async load() {
      return { blob: new Blob() };
    }
  },
}));

const three = {
  camera: {},
  gl: { domElement: document.createElement("canvas") },
  invalidate: () => undefined,
  scene: {},
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const savedAvatar = ref("avatar");
const loadAvatar = async () => ({
  files: [{ role: "model", sha256: "a".repeat(64) }],
});

let root: Root;

/** Let the stage's chained awaits (preview, bytes, load) run. */
async function flush() {
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function settings(springMode: string, materialMode: string | null) {
  setFakeSettings(springMode, materialMode);
  await act(async () =>
    root.render(
      <CreateAnimaStage
        avatar={savedAvatar}
        file={null}
        loadAvatar={loadAvatar as never}
        onUpload={vi.fn()}
        suspended={false}
        onFinished={vi.fn()}
      />,
    ),
  );
  await flush();
}

beforeEach(() => {
  resetFakeSettingsAvatars();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:avatar",
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  // react-dom does not know R3F's <primitive>.
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CreateAnimaStage Avatar settings", () => {
  it("loads a saved Avatar with its settings, changes the wind live and reloads for materials", async () => {
    await settings("automatic", null);
    expect(fakeAvatars).toHaveLength(0);

    await settings("springs_off", "simple");
    expect(new Set(fakeSettingsItemIds)).toEqual(new Set(["avatar"]));
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

describe("CreateAnimaStage upload Avatar state", () => {
  async function renderUpload(onAvatarStateChange: (state: unknown) => void) {
    setFakeSettings("automatic", "automatic");
    await act(async () =>
      root.render(
        <CreateAnimaStage
          avatar={null}
          file={new File([new Uint8Array(4)], "upload.vrm")}
          loadAvatar={loadAvatar as never}
          onUpload={vi.fn()}
          suspended={false}
          onFinished={vi.fn()}
          onAvatarStateChange={onAvatarStateChange}
        />,
      ),
    );
    await flush();
  }

  it("reports the upload's Avatar once it loads", async () => {
    const states: Array<{ avatar: unknown; status: string }> = [];
    await renderUpload((state) => states.push(state as never));
    expect(states.at(-1)).toEqual({ avatar: null, status: "loading" });

    await act(async () => fakeAvatars[0]!.finishLoad());
    await flush();
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.avatar).not.toBeNull();
  });

  it("reports a failed load without an Avatar", async () => {
    const states: Array<{ avatar: unknown; status: string }> = [];
    await renderUpload((state) => states.push(state as never));
    await act(async () => fakeAvatars[0]!.failLoad());
    await flush();
    expect(states.at(-1)).toEqual({ avatar: null, status: "failed" });
  });
});
