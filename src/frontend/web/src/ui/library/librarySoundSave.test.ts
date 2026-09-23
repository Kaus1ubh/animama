import { describe, expect, it } from "vitest";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import { librarySoundSaveInput } from "./librarySoundSave";

const item = {
  source: null,
  state: "ready",
  created_at: null,
  updated_at: null,
  item_id: "catalog-sound",
  logical_key: "local:sound:bell",
  origin: "owned",
  revision_sha256: "original-revision",
  name: "Bell",
  description: "Preserve this description",
  metadata: {
    schema_version: 1,
    id: "local:sound:bell",
    name: "Bell",
    defaults: { volume: 0.35 },
    provenance: { author: "Owner" },
  },
} as PyCatalogViewItem;

describe("Library sound updates", () => {
  it("preserves identity, default volume and hidden metadata on rename or replacement", () => {
    const replacement = new File(["audio"], "new.wav", { type: "audio/wav" });
    const input = librarySoundSaveInput(
      item,
      " New bell ",
      replacement,
      "receipt",
    );
    expect(input).toEqual({
      kind: "sound_effect",
      entryName: "sound",
      catalogItemId: "catalog-sound",
      expectedRevision: "original-revision",
      operationId: "receipt",
      files: [replacement],
      metadata: {
        ...item.metadata,
        name: "New bell",
        description: "Preserve this description",
      },
    });
    expect(item.metadata?.name).toBe("Bell");
  });
  it("does not grant update authority to Included or revisionless content", () => {
    const file = new File(["audio"], "bell.wav");
    expect(() =>
      librarySoundSaveInput(
        { ...item, origin: "builtin" },
        "Bell",
        file,
        "receipt",
      ),
    ).toThrow("read-only");
    expect(() =>
      librarySoundSaveInput(
        { ...item, revision_sha256: undefined },
        "Bell",
        file,
        "receipt",
      ),
    ).toThrow("Reload");
  });
});

it("keeps display names independent of the portable update route token", () => {
  const result = librarySoundSaveInput(
    item,
    "猫 (1)",
    new File(["audio"], "old.wav"),
    "operation",
  );
  expect(result.entryName).toBe("sound");
  expect(result.metadata.name).toBe("猫 (1)");
});
