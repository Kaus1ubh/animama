// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createParticleVFXEditorDraftFromBlank,
  type ParticleVFXEditorDraft,
} from "@/lib/avatar/particle-vfx";
import type { CatalogSaveInput } from "@/lib/content/catalogApi";
import type { CreatorRecoveryStore } from "@/lib/content/creatorRecoveryStore";
import { particleVFXSaveAdapter } from "@/ui/particle-vfx-creator/useParticleVFXSave";
import { useCreatorSave, type CreatorSaveAdapter } from "./useCreatorSave";

const mocks = vi.hoisted(() => ({
  apiClient: { admitted: "composition client" },
  saveCatalogItem: vi.fn(),
  navigate: vi.fn(async () => undefined),
}));

vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@animama/product-ui", () => ({
  useProductApiClient: () => mocks.apiClient,
}));
vi.mock("@/hooks/useContentEditorSaveSource", () => ({
  useContentEditorSaveSource: () => ({
    resolveName: async (name: string, fallback: string) => name || fallback,
    target: (name: string) => ({
      logicalKey: `local:scene-effect:${name}`,
      catalogItemId: "item-1",
      expectedRevision: "revision-1",
    }),
    saved: async () => undefined,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/content/catalogApi", () => ({
  saveCatalogItem: mocks.saveCatalogItem,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = { name: string; body: string };
type Record = {
  userId: string;
  documentKey: string;
  operationId: string;
  snapshot: Snapshot;
};

/** In-memory recovery store that records what the hook asked of it. */
function memoryStore() {
  const records = new Map<string, Record>();
  const key = (userId: string, documentKey: string) =>
    `${userId}:${documentKey}`;
  const store = {
    save: vi.fn(async (record: Record) => {
      records.set(key(record.userId, record.documentKey), record);
      return { stored: true, metadataOnly: false, warning: null };
    }),
    load: vi.fn(
      async (userId: string, documentKey: string) =>
        records.get(key(userId, documentKey)) ?? null,
    ),
    clear: vi.fn(async (userId: string, documentKey: string) => {
      records.delete(key(userId, documentKey));
    }),
  } satisfies CreatorRecoveryStore<Record>;
  return { store, records };
}

function adapterFor(
  store: CreatorRecoveryStore<Record>,
): CreatorSaveAdapter<Snapshot, Record> {
  return {
    kind: "scene_effect",
    defaultName: "New Thing",
    savedMessage: "Saved.",
    pausedMessage: "Paused.",
    store,
    fingerprint: (snapshot) => JSON.stringify(snapshot),
    name: (snapshot) => snapshot.name,
    withName: (snapshot, name) => ({ ...snapshot, name }),
    buildPayload: async ({ snapshot, name }) => ({
      files: [],
      companionPaths: [],
      descriptor: { name },
      savedSnapshot: snapshot,
    }),
    toRecovery: ({ userId, documentKey, session, snapshot }) => ({
      userId,
      documentKey,
      operationId: session.operationId,
      snapshot,
    }),
    fromRecovery: (record) => ({
      snapshot: record.snapshot,
      operationId: record.operationId,
    }),
    editRoute: (itemId) => ({
      to: "/scene-effects/$sceneEffectId/edit",
      params: { sceneEffectId: itemId },
    }),
  };
}

type HookProps<
  TSnapshot,
  TRecord extends { userId: string; documentKey: string },
> = Parameters<typeof useCreatorSave<TSnapshot, TRecord>>[0];

/** Minimal renderHook: mounts the hook in a real React root and exposes rerender. */
function renderCreatorSave<
  TSnapshot,
  TRecord extends { userId: string; documentKey: string },
>(initialProps: HookProps<TSnapshot, TRecord>) {
  const result = {
    current: null as unknown as ReturnType<
      typeof useCreatorSave<TSnapshot, TRecord>
    >,
  };
  function Harness(props: HookProps<TSnapshot, TRecord>) {
    result.current = useCreatorSave(props);
    return null;
  }
  let root!: Root;
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(<Harness {...initialProps} />);
  });
  return {
    result,
    rerender: (props: HookProps<TSnapshot, TRecord>) =>
      act(() => root.render(<Harness {...props} />)),
    unmount: () => act(() => root.unmount()),
  };
}

/** Let promise chains settle and debounce timers fire inside act. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useCreatorSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.saveCatalogItem.mockReset();
    mocks.navigate.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const clean: Snapshot = { name: "Sparkle", body: "saved" };
  const edited: Snapshot = { name: "Sparkle", body: "edited" };

  function setup(itemId: string | undefined, seeded?: Record) {
    const { store, records } = memoryStore();
    if (seeded) records.set(`owner:${seeded.documentKey}`, seeded);
    const adapter = adapterFor(store);
    const onRestore = vi.fn();
    const onSaved = vi.fn();
    const props = (snapshot: Snapshot, dirty: boolean) => ({
      adapter,
      itemId,
      existing: itemId ? ({ item_id: itemId } as never) : undefined,
      snapshot,
      dirty,
      initialized: true,
      ready: true,
      onRestore,
      onSaved,
    });
    return { store, records, onRestore, onSaved, props };
  }

  it("restores a stored draft before any autosave writes", async () => {
    const seeded = {
      userId: "owner",
      documentKey: "new",
      operationId: "restored-operation",
      snapshot: edited,
    };
    const { store, onRestore, props } = setup(undefined, seeded);
    const hook = renderCreatorSave(props(clean, false));
    expect(hook.result.current.recoveryReady).toBe(false);

    await advance(0);
    expect(onRestore).toHaveBeenCalledWith(edited);
    expect(hook.result.current.recovered).toBe(true);
    expect(store.save).not.toHaveBeenCalled();

    hook.rerender(props(edited, true));
    await advance(400);
    expect(store.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationId: "restored-operation" }),
    );
    hook.unmount();
  });

  it("restores once when the restore callback changes identity", async () => {
    const seeded = {
      userId: "owner",
      documentKey: "new",
      operationId: "restored-operation",
      snapshot: edited,
    };
    const { store, onRestore, props } = setup(undefined, seeded);
    const hook = renderCreatorSave(props(clean, false));
    await advance(0);
    expect(onRestore).toHaveBeenCalledOnce();

    // A UI Locale change gives creators a new callback that words its text.
    const reworded = vi.fn();
    hook.rerender({ ...props(edited, true), onRestore: reworded });
    await advance(0);
    expect(store.load).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledOnce();
    expect(reworded).not.toHaveBeenCalled();
    expect(hook.result.current.recovered).toBe(true);
    hook.unmount();
  });

  it("autosaves only while dirty, and clears once the document is unchanged again", async () => {
    const { store, records, props } = setup("item-1");
    const hook = renderCreatorSave(props(clean, false));
    await advance(400);
    expect(store.save).not.toHaveBeenCalled();

    hook.rerender(props(edited, true));
    await advance(300);
    expect(store.save).not.toHaveBeenCalled();
    await advance(100);
    expect(store.save).toHaveBeenCalledOnce();
    expect(records.get("owner:item-1")?.snapshot).toEqual(edited);

    hook.rerender(props(clean, false));
    await advance(400);
    expect(records.has("owner:item-1")).toBe(false);
    hook.unmount();
  });

  it("keeps a failed Save's operation ID across an unchanged document and a reload", async () => {
    const { records, props } = setup("item-1");
    mocks.saveCatalogItem.mockRejectedValueOnce(new Error("network"));
    const first = renderCreatorSave(props(clean, false));
    await advance(400);
    await act(async () => {
      expect(await first.result.current.save()).toBe(false);
    });
    const failedId = (
      mocks.saveCatalogItem.mock.calls[0]?.[1] as CatalogSaveInput
    ).operationId;
    await advance(400);
    // The unchanged document must not clear the pending operation's record.
    expect(records.get("owner:item-1")?.operationId).toBe(failedId);
    first.unmount();

    const reloaded = renderCreatorSave(props(clean, false));
    await advance(400);
    expect(records.get("owner:item-1")?.operationId).toBe(failedId);
    // Saves use the admitted composition's API client, never a module default.
    expect(mocks.saveCatalogItem.mock.calls[0]?.[0]).toBe(mocks.apiClient);
    mocks.saveCatalogItem.mockResolvedValueOnce({ item_id: "item-1" });
    await act(async () => {
      expect(await reloaded.result.current.save()).toBe(true);
    });
    expect(
      (mocks.saveCatalogItem.mock.calls[1]?.[1] as CatalogSaveInput)
        .operationId,
    ).toBe(failedId);
    expect(records.has("owner:item-1")).toBe(false);
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true, ignoreBlocker: true }),
    );
    reloaded.unmount();
  });

  it("stores the unchanged document after undoing to it following a failed Save", async () => {
    const { records, props } = setup("item-1");
    mocks.saveCatalogItem.mockRejectedValueOnce(new Error("network"));
    const hook = renderCreatorSave(props(edited, true));
    await advance(400);
    await act(async () => {
      expect(await hook.result.current.save()).toBe(false);
    });
    const failedId = records.get("owner:item-1")?.operationId;
    hook.rerender(props(clean, false));
    await advance(400);
    const record = records.get("owner:item-1");
    expect(record?.snapshot).toEqual(clean);
    expect(record?.operationId).toBe(failedId);
    hook.unmount();
  });

  it("discardRecovery drops the preserved operation but keeps the document", async () => {
    const { records, props } = setup("item-1");
    mocks.saveCatalogItem.mockRejectedValueOnce(new Error("network"));
    const hook = renderCreatorSave(props(edited, true));
    await advance(400);
    await act(async () => {
      await hook.result.current.save();
    });
    const failedId = records.get("owner:item-1")?.operationId;
    await act(async () => {
      await hook.result.current.discardRecovery();
    });
    expect(hook.result.current.recovered).toBe(false);
    expect(hook.result.current.error).toBeNull();
    const next = records.get("owner:item-1");
    expect(next?.snapshot).toEqual(edited);
    expect(next?.operationId).not.toBe(failedId);
    hook.unmount();
  });

  it("discardChanges clears strictly and stops autosave", async () => {
    const { store, records, props } = setup(undefined);
    const hook = renderCreatorSave(props(edited, true));
    await advance(0); // recovery load settles; the debounce starts after it
    await advance(400);
    expect(records.has("owner:new")).toBe(true);

    await act(async () => {
      expect(await hook.result.current.discardChanges()).toBe(true);
    });
    expect(store.clear).toHaveBeenLastCalledWith("owner", "new", {
      strict: true,
    });
    hook.rerender(props({ name: "Sparkle", body: "after discard" }, true));
    await advance(400);
    expect(records.has("owner:new")).toBe(false);
    hook.unmount();
  });

  it("resetSession resumes autosave only once the new document is installed", async () => {
    const { store, records, props } = setup(undefined);
    const hook = renderCreatorSave(props(edited, true));
    await advance(0);
    await advance(400);
    const blank = { name: "", body: "" };
    await act(async () => {
      expect(await hook.result.current.resetSession(blank)).toBe(true);
    });
    expect(store.clear).toHaveBeenLastCalledWith("owner", "new", {
      strict: true,
    });
    // Still the discarded document: recovery waits for the reset one.
    hook.rerender(props({ name: "Sparkle", body: "late edit" }, true));
    await advance(400);
    expect(records.has("owner:new")).toBe(false);
    hook.rerender(props(blank, false));
    await advance(400);
    hook.rerender(props({ name: "", body: "fresh" }, true));
    await advance(400);
    expect(records.get("owner:new")?.snapshot).toEqual({
      name: "",
      body: "fresh",
    });
    hook.unmount();
  });

  it("recovers a Particle draft after a reload", async () => {
    // happy-dom has no IndexedDB, so this exercises the real localStorage fallback.
    const draft = particleVFXSaveAdapter.withName(
      createParticleVFXEditorDraftFromBlank(),
      "Hearts",
    );
    const onRestore = vi.fn();
    const props = (snapshot: ParticleVFXEditorDraft, dirty: boolean) => ({
      adapter: particleVFXSaveAdapter,
      existing: undefined,
      snapshot,
      dirty,
      initialized: true,
      ready: true,
      onRestore,
      onSaved: vi.fn(),
    });
    const before = renderCreatorSave(
      props(createParticleVFXEditorDraftFromBlank(), false),
    );
    await advance(0);
    before.rerender(props(draft, true));
    await advance(400);
    before.unmount();
    expect(onRestore).not.toHaveBeenCalled();

    const after = renderCreatorSave(
      props(createParticleVFXEditorDraftFromBlank(), false),
    );
    await advance(0);
    expect(onRestore).toHaveBeenCalledOnce();
    const restored = onRestore.mock.calls[0]?.[0] as ParticleVFXEditorDraft;
    expect(restored.catalog.label).toBe("Hearts");
    expect(restored.quarksJson).toEqual(draft.quarksJson);
    expect(after.result.current.recovered).toBe(true);
    after.unmount();
  });
});
