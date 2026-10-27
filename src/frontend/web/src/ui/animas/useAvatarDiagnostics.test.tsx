// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import type { AvatarLiveDiagnostics } from "@/lib/avatar/diagnostics/avatarDiagnostics";
import type { AvatarIssue } from "@/lib/avatar/diagnostics/issues";
import { avatarDiagnosticsText } from "@/lib/avatar/diagnostics/avatarDiagnosticsReport";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import {
  registerPreviewDockAvatar,
  usePreviewDockAvatarStore,
} from "@/stores/preview-dock-avatar-store";
import {
  useAvatarDiagnostics,
  type AvatarDiagnosticsSource,
  type AvatarDiagnosticsView,
} from "./useAvatarDiagnostics";

const runtime = vi.hoisted(() => ({
  entry: {
    runtime_id: "content-1",
    config: {},
    source: { type: "public_url" },
  },
  release: vi.fn(),
  apiClient: {},
  /** The item entry's saved face part correction, as the preview carries it. */
  itemFaceParts: undefined as unknown,
  itemEntry: vi.fn(async (_client: unknown, itemId: string) => ({
    runtime_id: `preview-${itemId}`,
    config: {
      avatar_catalog_item_id: itemId,
      ...(runtime.itemFaceParts ? { face_parts: runtime.itemFaceParts } : {}),
    },
    source: {
      type: "authorized_files",
      files: [{ role: "model", filename: "m.vrm", sha256: "sha-item" }],
    },
  })),
}));
vi.mock("@animama/product-ui", () => ({
  useProductApiClient: () => runtime.apiClient,
}));
vi.mock("@/lib/content/avatarPreviewTarget", () => ({
  avatarItemRuntimeEntry: runtime.itemEntry,
}));
vi.mock("@/query/hooks/useAnimaRuntimeCatalog", () => ({
  useAnimaRuntimeCatalog: (animaId: string | null) => ({
    data: animaId
      ? {
          avatar_effects: [
            {
              runtime_id: "ray-secret-blush",
              name: "Ray Secret Blush",
              source: { source: "local", item_id: "item-fx" },
            },
          ],
        }
      : undefined,
    isPending: false,
  }),
}));
vi.mock("@/lib/runtime-content/runtimeSnapshotAdapter", () => ({
  adaptRuntimeSnapshot: () => ({ avatar_model: runtime.entry }),
}));
vi.mock("@/query/hooks/useAnimaLoadout", () => ({
  useAnimaLoadout: () => ({
    data: { avatar_source: { source: "local", catalog_item_id: "item-9" } },
  }),
}));
// One object each, as the real hooks keep them across renders.
const avatarSettings = vi.hoisted(() => ({
  stored: {
    data: {
      item_id: "item-9",
      spring_mode: "off",
      spring_mode_source: "stored",
      material_mode: "automatic",
      material_mode_source: "default",
    },
  },
  none: { data: undefined },
  load: {
    springMode: "off",
    springModeRef: { current: "off" },
    materialMode: "automatic",
  },
}));
vi.mock("@/query/hooks/useAvatarSettings", () => ({
  // Without an item (an unsaved upload) the real query never runs.
  useAvatarSettings: (itemId: string | null) =>
    itemId ? avatarSettings.stored : avatarSettings.none,
  useAvatarLoadSettings: () => avatarSettings.load,
}));
vi.mock("@/lib/runtime-content/runtimeContentDelivery", () => ({
  preparedRuntimeResourceUrls: () => undefined,
  runtimeContentDeliveryUrl: () => "/avatar-file",
  runtimeContentDownloadUrl: async () => ({
    url: "http://localhost/avatar-file",
    release: runtime.release,
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A GLB holding only `json`. */
function glb(json: unknown): ArrayBuffer {
  const text = JSON.stringify(json);
  const chunk = new TextEncoder().encode(
    text.padEnd(Math.ceil(text.length / 4) * 4, " "),
  );
  const bytes = new Uint8Array(20 + chunk.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, chunk.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(chunk, 20);
  return bytes.buffer;
}

/** A GLB that needs a decoder Animama does not install. */
const dracoGlb = () =>
  glb({
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_draco_mesh_compression"],
    extensionsRequired: ["KHR_draco_mesh_compression"],
    meshes: [{ primitives: [{ attributes: {} }] }],
  });

/** The chat stage's Avatar, as far as the hook reads it. */
function stageAvatar(vrmSha256: string | null = null) {
  const listeners = new Set<() => void>();
  let issues: AvatarIssue[] = [];
  const avatar = {
    vrm: {},
    vrmSha256,
    getDiagnostics: () => ({ issues }) as unknown as AvatarLiveDiagnostics,
    subscribeDiagnostics: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
  };
  return {
    avatar: avatar as unknown as Avatar,
    dispose: avatar.dispose,
    report(next: AvatarIssue[]) {
      issues = next;
      for (const listener of listeners) listener();
    },
  };
}

let root: Root | null = null;
let view: AvatarDiagnosticsView | null = null;

const ANIMA: AvatarDiagnosticsSource = { kind: "anima", animaId: "anima-1" };

function Probe({
  source,
  enabled,
  onView,
}: {
  source: AvatarDiagnosticsSource;
  enabled: boolean;
  onView: (next: AvatarDiagnosticsView) => void;
}) {
  const next = useAvatarDiagnostics(source, enabled);
  useEffect(() => onView(next));
  return null;
}

function render(enabled: boolean, source: AvatarDiagnosticsSource = ANIMA) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root ??= createRoot(container);
    root.render(
      <Probe
        source={source}
        enabled={enabled}
        onView={(next) => {
          view = next;
        }}
      />,
    );
  });
}

async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function serve(bytes: ArrayBuffer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes.slice(0))),
  );
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  runtime.release.mockReset();
  runtime.itemEntry.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  view = null;
  vi.unstubAllGlobals();
  useAvatarLipSyncBridgeStore.setState({ avatar: null, avatarAnimaId: null });
  usePreviewDockAvatarStore.setState({ avatar: null, itemId: null });
  document.body.replaceChildren();
});

describe("useAvatarDiagnostics", () => {
  it("describes a file that does not load, with its load error", async () => {
    serve(dracoGlb());
    render(true);
    await settle(() => view?.state.status === "ready");

    const state = view!.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.live).toBe(false);
    expect(state.report).toMatchObject({
      avatar: { source: "local", itemId: "item-9" },
      status: "failed",
      file: { extensionsRequired: ["KHR_draco_mesh_compression"] },
      live: null,
      issues: [{ code: "avatar_load_failed" }],
    });
    expect(view!.effectNames.get("ray-secret-blush")).toBe("Ray Secret Blush");

    render(false);
    expect(runtime.release).toHaveBeenCalled();
  });

  it("reads the Anima's Avatar on the chat stage and follows its changes", async () => {
    serve(glb({ extensions: { VRMC_vrm: { specVersion: "1.0" } } }));
    const stage = stageAvatar();
    useAvatarLipSyncBridgeStore.setState({
      avatar: stage.avatar,
      avatarAnimaId: "anima-1",
    });
    render(true);
    await settle(() => view?.state.status === "ready");

    const first = view!.state;
    if (first.status !== "ready") throw new Error("not ready");
    expect(first.live).toBe(true);
    expect(first.report).toMatchObject({ status: "loaded", issues: [] });
    expect(first.report.settings).toEqual({
      springMode: "off",
      springModeSource: "stored",
      materialMode: "automatic",
      materialModeSource: "default",
    });
    expect(first.report.file?.vrmVersion).toBe("1.0");

    // A Local effect's runtime id is a slug of its owner's name for it.
    const skipped = {
      code: "effect_face_part_missing",
      params: { effectId: "ray-secret-blush", part: "eyelash" },
    } as const;
    act(() =>
      stage.report([
        skipped,
        { code: "effect_unknown", params: { effectId: "x" } },
      ]),
    );
    const next = view!.state;
    if (next.status !== "ready") throw new Error("not ready");
    // The screen words the effect by name; the report names it by item id.
    expect(next.issues).toEqual([
      skipped,
      { code: "effect_unknown", params: { effectId: "x" } },
    ]);
    expect(next.report.issues).toEqual([
      {
        code: "effect_face_part_missing",
        params: { part: "eyelash", effect: "local:item-fx" },
      },
      { code: "effect_unknown", params: { effect: "unlisted" } },
    ]);
    expect(JSON.stringify(next.report)).not.toContain("secret");
    // The chat stage owns its Avatar: closing leaves it loaded.
    render(false);
    expect(stage.dispose).not.toHaveBeenCalled();
  });

  it("reports an Anima without an Avatar", async () => {
    const entry = runtime.entry;
    runtime.entry = null as never;
    try {
      render(true);
      await settle(() => view?.state.status !== "loading");
      expect(view!.state.status).toBe("unavailable");
    } finally {
      runtime.entry = entry;
    }
  });

  it("loads an Avatar item off screen when the preview dock shows another", async () => {
    serve(dracoGlb());
    // The dock shows a different item, so its Avatar is not this one.
    registerPreviewDockAvatar(stageAvatar().avatar, "item-other");
    render(true, { kind: "avatar", itemId: "item-7", source: "included" });
    await settle(() => view?.state.status === "ready");

    const state = view!.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(runtime.itemEntry).toHaveBeenCalledWith(
      runtime.apiClient,
      "item-7",
      expect.any(AbortSignal),
    );
    expect(state.live).toBe(false);
    expect(state.report).toMatchObject({
      avatar: { source: "included", itemId: "item-7" },
      status: "failed",
      file: { extensionsRequired: ["KHR_draco_mesh_compression"] },
      issues: [{ code: "avatar_load_failed" }],
    });
    // Effect warnings belong to an Anima's loadout only.
    expect(view!.effectNames.size).toBe(0);
    render(false);
    expect(runtime.release).toHaveBeenCalled();
  });

  it("reads an Avatar item from the preview dock when it shows that item", async () => {
    serve(glb({ extensions: { VRMC_vrm: { specVersion: "1.0" } } }));
    const dock = stageAvatar("sha-item");
    registerPreviewDockAvatar(dock.avatar, "item-7");
    render(true, { kind: "avatar", itemId: "item-7", source: "local" });
    await settle(() => view?.state.status === "ready");

    const state = view!.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.live).toBe(true);
    expect(state.report).toMatchObject({
      avatar: { source: "local", itemId: "item-7" },
      status: "loaded",
      file: { vrmVersion: "1.0" },
    });
    // Effect findings from the dock's own previews belong to no Anima.
    const springs = { code: "springs_metadata_missing" } as AvatarIssue;
    act(() =>
      dock.report([
        springs,
        {
          code: "effect_attachment_limit",
          params: { effectId: "dock-preview-fx" },
        },
      ]),
    );
    const next = view!.state;
    if (next.status !== "ready") throw new Error("not ready");
    expect(next.issues).toEqual([springs]);
    expect(next.report.issues).toEqual([springs]);
    // The dock owns its Avatar.
    render(false);
    expect(dock.dispose).not.toHaveBeenCalled();
  });

  it("loads an Avatar item off screen when the dock holds an older revision", async () => {
    serve(dracoGlb());
    registerPreviewDockAvatar(stageAvatar("sha-older").avatar, "item-7");
    render(true, { kind: "avatar", itemId: "item-7", source: "local" });
    await settle(() => view?.state.status === "ready");
    const state = view!.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.live).toBe(false);
    expect(state.report.issues).toEqual([{ code: "avatar_load_failed" }]);
  });

  it("reports an Avatar item's invalid saved face part correction", async () => {
    serve(dracoGlb());
    runtime.itemFaceParts = { schema: "not-a-correction" };
    try {
      render(true, { kind: "avatar", itemId: "item-7", source: "local" });
      await settle(() => view?.state.status === "ready");
      const state = view!.state;
      if (state.status !== "ready") throw new Error("not ready");
      expect(state.report.issues).toContainEqual({
        code: "face_parts_correction_invalid",
      });
    } finally {
      runtime.itemFaceParts = undefined;
    }
  });

  it("describes an unsaved upload from its file and the stage's Avatar", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const file = new File(
      [glb({ extensions: { VRM: { specVersion: "0.0" } } })],
      "Secret Name Of Model.vrm",
    );
    const stage = stageAvatar();
    render(true, { kind: "upload", file, avatar: null, stage: "loading" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(view!.state.status).toBe("loading");

    render(true, {
      kind: "upload",
      file,
      avatar: stage.avatar,
      stage: "ready",
    });
    await settle(() => view?.state.status === "ready");
    const state = view!.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.live).toBe(true);
    expect(state.report).toMatchObject({
      avatar: { source: "upload", itemId: null },
      status: "loaded",
      settings: null,
      file: { vrmVersion: "0.x" },
      issues: [],
    });
    // The file is read locally; nothing is downloaded or loaded again.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runtime.itemEntry).not.toHaveBeenCalled();
    expect(JSON.stringify(state.report)).not.toContain("Secret");
    render(false, {
      kind: "upload",
      file,
      avatar: stage.avatar,
      stage: "ready",
    });
    expect(stage.dispose).not.toHaveBeenCalled();
  });

  it("keeps an upload's file facts and the load error when the stage fails", async () => {
    const file = new File([dracoGlb()], "Secret Name Of Model.vrm");
    render(true, { kind: "upload", file, avatar: null, stage: "failed" });
    await settle(() => view?.state.status === "ready");
    const state = view!.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.live).toBe(false);
    expect(state.report).toMatchObject({
      avatar: { source: "upload", itemId: null },
      status: "failed",
      file: { extensionsRequired: ["KHR_draco_mesh_compression"] },
      issues: [{ code: "avatar_load_failed" }],
    });
    // A report names an upload by kind only.
    for (const text of [
      JSON.stringify(state.report),
      avatarDiagnosticsText(state.report),
    ]) {
      expect(text).not.toContain("Secret");
      expect(text).not.toContain(".vrm");
    }
  });
});
