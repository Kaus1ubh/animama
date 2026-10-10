import { describe, expect, it } from "vitest";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import { listedEffectRows } from "./useEffects";

const row = (
  name: string,
  overrides: Partial<PyCatalogViewItem> = {},
): PyCatalogViewItem =>
  ({
    item_id: name,
    name,
    description: null,
    source: null,
    origin: "builtin",
    catalog_source: "included",
    state: "ready",
    created_at: null,
    updated_at: null,
    ...overrides,
  }) as PyCatalogViewItem;

describe("listedEffectRows", () => {
  it("never lists licensed built-in sounds", () => {
    const rows = [
      row("Pop", { portability: "non-portable" }),
      row("Bell"),
      row("Mine", { origin: "owned", catalog_source: "local" }),
      // A Local copy of restricted bytes stays visible so it can be deleted.
      row("Copy", {
        origin: "owned",
        catalog_source: "local",
        portability: "non-portable",
      }),
    ];
    expect(
      listedEffectRows("sound_effect", rows, {}).map((item) => item.name),
    ).toEqual(["Bell", "Copy", "Mine"]);
  });

  it("keeps other families' rows, filtered by origin and query", () => {
    const rows = [
      row("Sweat Drop", { portability: "non-portable" }),
      row("Blush"),
    ];
    expect(
      listedEffectRows("avatar_effect", rows, { query: "sweat" }).map(
        (item) => item.name,
      ),
    ).toEqual(["Sweat Drop"]);
    expect(
      listedEffectRows("avatar_effect", rows, { origin: "owned" }),
    ).toEqual([]);
  });
});
