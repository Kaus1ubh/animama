// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import type { AvatarLiveDiagnostics } from "@/lib/avatar/diagnostics/avatarDiagnostics";
import type { AvatarIssue } from "@/lib/avatar/diagnostics/issues";
import { useAvatarLipSyncBridgeStore } from "@/stores/avatar-lipsync-bridge-store";
import {
  useAvatarDiagnostics,
  type AvatarDiagnosticsView,
} from "./useAvatarDiagnostics";

const runtime = vi.hoisted(() => ({
  entry: {
    runtime_id: "content-1",
    config: {},
    source: { type: "public_url" },
  },
  release: vi.fn(),
}));
vi.mock("@/query/hooks/useAnimaRuntimeCatalog", () => ({
  useAnimaRuntimeCatalog: () => ({
    data: {
      avatar_effects: [
        {
          runtime_id: "ray-secret-blush",
          name: "Ray Secret Blush",
          source: { source: "local", item_id: "item-fx" },
        },
      ],
    },
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
function stageAvatar() {
  const listeners = new Set<() => void>();
  let issues: AvatarIssue[] = [];
  const avatar = {
    vrm: {},
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

function Probe({
  enabled,
  onView,
}: {
  enabled: boolean;
  onView: (next: AvatarDiagnosticsView) => void;
}) {
  const next = useAvatarDiagnostics("anima-1", enabled);
  useEffect(() => onView(next));
  return null;
}

function render(enabled: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root ??= createRoot(container);
    root.render(
      <Probe
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
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  view = null;
  vi.unstubAllGlobals();
  useAvatarLipSyncBridgeStore.setState({ avatar: null, avatarAnimaId: null });
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
});
