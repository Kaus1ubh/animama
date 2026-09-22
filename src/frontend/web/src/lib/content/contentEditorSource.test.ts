import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ContentKind,
  PyCatalogViewItem,
  PyContentPreview,
} from "./catalogTypes";
import {
  contentEditorSaveTarget,
  ContentEditorHydration,
  loadCreatorPreviewFile,
} from "./contentEditorSource";
const source = {
  item_id: "included-one",
  logical_key: "builtin:effect:one",
  revision_sha256: "source-r1",
  origin: "builtin",
} as PyCatalogViewItem;
describe("Library creator sources", () => {
  it.each([
    "particle_effect",
    "avatar_effect",
    "scene_effect",
    "sound_effect",
  ] satisfies ContentKind[])(
    "copies Included %s and retains Local update identity",
    (kind) => {
      const copy = contentEditorSaveTarget(source, kind, "My copy");
      expect(copy.logicalKey).toMatch(/^local:/);
      expect(copy.catalogItemId).toBeUndefined();
      expect(copy.expectedRevision).toBeUndefined();
      expect(
        contentEditorSaveTarget(
          { ...source, origin: "owned", logical_key: "local:effect:one" },
          kind,
          "Renamed",
        ),
      ).toEqual({
        logicalKey: "local:effect:one",
        catalogItemId: "included-one",
        expectedRevision: "source-r1",
      });
    },
  );
  it("loads exact existing audio or animation bytes and releases its decoder URL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const preview = {
      preview_id: "p",
      revision: "r",
      revision_sha256: "r",
      expires_at: "2099-01-01",
      metadata: {},
      files: [
        {
          file_ref: "f",
          role: "audio",
          filename: "sound.wav",
          ordinal: 1,
          media_type: "audio/wav",
          size_bytes: 4,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          url: "/v1/content/previews/p/revisions/r/files/f",
        },
      ],
    } satisfies PyContentPreview;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    try {
      const file = await loadCreatorPreviewFile(preview, "audio");
      expect(file.name).toBe("sound.wav");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
      expect(revoke).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      revoke.mockRestore();
    }
  });
});

describe("editor hydration lifetime", () => {
  it("keeps newer draft/audio after saved metadata refresh", () => {
    const hydration = new ContentEditorHydration();
    const load = hydration.begin("included")!;
    load.complete();
    hydration.preserve("local-copy");
    const draft = {
      name: "Unsaved change",
      audio: new File(["new"], "new.wav"),
    };
    load.cancel();
    const refresh = hydration.begin("local-copy");
    if (refresh) {
      draft.name = "Older saved name";
      draft.audio = new File(["old"], "old.wav");
      refresh.complete();
    }
    expect(refresh).toBeNull();
    expect(draft.name).toBe("Unsaved change");
    expect(draft.audio.name).toBe("new.wav");
    expect(hydration.begin("different-item")).not.toBeNull();
  });
  it("retries canceled initial hydration and ignores the obsolete completion", () => {
    const hydration = new ContentEditorHydration();
    const first = hydration.begin("item")!;
    first.cancel();
    const retry = hydration.begin("item")!;
    first.complete();
    first.cancel();
    expect(hydration.begin("item")).toBeNull();
    retry.cancel();
    expect(hydration.begin("item")).not.toBeNull();
  });
  it("does not reload a completed item when detail changes", () => {
    const hydration = new ContentEditorHydration();
    const load = hydration.begin("item")!;
    load.complete();
    load.cancel();
    expect(hydration.begin("item")).toBeNull();
  });
});
