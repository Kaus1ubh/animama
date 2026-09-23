import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCatalogItems } from "@/lib/content/catalogApi";
import { useContentEditorSaveSource } from "./useContentEditorSaveSource";
import { queryKeys } from "@/query/keys";
import type {
  PyCatalogViewItem,
  PyContentItem,
} from "@/lib/content/catalogTypes";
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeOwnerId: () => "owner",
}));
vi.mock("@/lib/content/catalogApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content/catalogApi")>()),
  listCatalogItems: vi.fn(),
}));

beforeEach(() => vi.mocked(listCatalogItems).mockReset());

describe.each([
  ["avatar_effect", "New Avatar FX"],
  ["scene_effect", "New Scene FX"],
  ["particle_effect", "New Particle FX"],
] as const)("%s unnamed saves", (kind, fallback) => {
  function openSession(existing?: PyCatalogViewItem) {
    let session!: ReturnType<typeof useContentEditorSaveSource>;
    function Harness() {
      session = useContentEditorSaveSource(kind, existing?.item_id, existing);
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    return session;
  }

  it("allocates a numbered fallback across case-insensitive catalog collisions", async () => {
    vi.mocked(listCatalogItems).mockResolvedValue([
      { item_id: "a", name: fallback.toLowerCase() },
      { item_id: "b", name: `${fallback} 1` },
    ] as PyContentItem[]);

    expect(await openSession().resolveName("  ", fallback)).toBe(
      `${fallback} 2`,
    );
    expect(listCatalogItems).toHaveBeenCalledWith(kind);
  });

  it("preserves an explicit name without requiring a catalog lookup", async () => {
    expect(await openSession().resolveName("  My FX  ", fallback)).toBe(
      "My FX",
    );
    expect(listCatalogItems).not.toHaveBeenCalled();
  });

  it.each(["owned", "builtin"] as const)(
    "excludes only an existing Local update, preserving collisions for %s sources",
    async (origin) => {
      const existing = {
        item_id: "source",
        name: fallback,
        origin,
      } as PyCatalogViewItem;
      vi.mocked(listCatalogItems).mockResolvedValue([
        { item_id: existing.item_id, name: existing.name } as PyContentItem,
      ]);

      expect(await openSession(existing).resolveName("", fallback)).toBe(
        origin === "owned" ? fallback : `${fallback} 1`,
      );
    },
  );
});

const cases = [
  ["avatar_effect", queryKeys.avatarEffects],
  ["scene_effect", queryKeys.sceneEffects],
  ["particle_effect", queryKeys.particleEffects],
  ["sound_effect", queryKeys.soundEffects],
] as const;

describe.each(cases)("%s save metadata", (kind, keys) => {
  it.each(["owned", "builtin"] as const)(
    "saves twice without a poll or remount from %s",
    async (origin) => {
      const client = new QueryClient();
      const initial = {
        item_id: "source",
        origin,
        logical_key: "original-key",
        revision_sha256: "r1",
        name: "Original",
      } as PyCatalogViewItem;
      const includedKey = keys.detail("owner", "source");
      client.setQueryData(includedKey, initial);
      const listKey = [...keys.all("owner"), "list"];
      client.setQueryData(listKey, []);
      let session!: ReturnType<typeof useContentEditorSaveSource>;
      function Harness() {
        session = useContentEditorSaveSource(kind, "source", initial);
        return null;
      }
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
      // Another writer publishes r2 while this editor still contains the r1 draft.
      client.setQueryData(includedKey, {
        ...initial,
        revision_sha256: "external-r2",
      });
      const first = session.target("First save");
      expect(first.catalogItemId).toBe(
        origin === "owned" ? "source" : undefined,
      );
      expect(first.expectedRevision).toBe(
        origin === "owned" ? "r1" : undefined,
      );
      const savedId = origin === "owned" ? "source" : "local-copy";
      const saved = {
        item_id: savedId,
        kind,
        source: "local",
        status: "valid",
        logical_key: first.logicalKey,
        revision_sha256: "r2",
        name: "First save",
      } as PyContentItem;
      await session.saved(saved);
      // An acknowledged save advances the same editing session without a remount.
      expect(session.target("Second save")).toEqual({
        catalogItemId: savedId,
        expectedRevision: "r2",
        logicalKey: first.logicalKey,
      });
      await session.saved({
        ...saved,
        revision_sha256: "r3",
        name: "Second save",
      });
      client.setQueryData(keys.detail("owner", savedId), {
        ...saved,
        revision_sha256: "external-r4",
      });
      expect(session.target("Third draft").expectedRevision).toBe("r3");
      expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
      if (origin === "builtin")
        expect(client.getQueryData(includedKey)).toEqual({
          ...initial,
          revision_sha256: "external-r2",
        });
      client.clear();
    },
  );
});
