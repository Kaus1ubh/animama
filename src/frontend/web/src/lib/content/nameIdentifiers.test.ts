import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { gestureSemanticKey } from "@/ui/action-editor/actionDocument";
import { localContentLogicalKey } from "./catalogApi";
import { contentEntryName, contentSlug, nameHash } from "./nameIdentifiers";

type FixtureRow = {
  name: string;
  hash: string;
  semanticKey: string;
  slug: string;
  entryName: string;
};

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/name-identifiers.json", import.meta.url),
    "utf8",
  ),
) as { names: FixtureRow[] };

// Backend patterns (content_kind_registry.py) the proposed identifiers must satisfy.
const SEMANTIC_KEY = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const LOGICAL_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/;

describe("name-derived identifiers", () => {
  it("keep today's identifiers for names that fold to ASCII", () => {
    expect(gestureSemanticKey("Heart Hands")).toBe("heart_hands");
    expect(gestureSemanticKey("Café Wave")).toBe("cafe_wave");
    expect(gestureSemanticKey("Pokémon Dance")).toBe("poke_mon_dance");
    expect(gestureSemanticKey("!!!")).toBe("new_gesture");
    expect(contentSlug("Heart Hands")).toBe("heart-hands");
    expect(contentSlug("")).toBe("untitled");
    expect(localContentLogicalKey("idle_style", "Calm Idle")).toBe(
      "local:idle-style:calm-idle",
    );
  });

  it("give names in other scripts distinct, valid identifiers", () => {
    const names = ["おじぎ", "お辞儀", "인사", "鞠躬", "鞠躬 2", "Bow おじぎ"];
    const keys = names.map(gestureSemanticKey);
    const slugs = names.map((name) => contentSlug(name));
    expect(new Set(keys).size).toBe(names.length);
    expect(new Set(slugs).size).toBe(names.length);
    for (const key of keys) expect(key).toMatch(SEMANTIC_KEY);
    for (const name of names)
      expect(localContentLogicalKey("gesture", name)).toMatch(LOGICAL_KEY);
    expect(gestureSemanticKey("Bow おじぎ")).toMatch(/^bow_[0-9a-z]{7}$/);
    expect(gestureSemanticKey("おじぎ")).toMatch(/^gesture_[0-9a-z]{7}$/);
  });

  it("ignore surrounding spaces, including ideographic spaces", () => {
    expect(gestureSemanticKey("おじぎ\u3000")).toBe(
      gestureSemanticKey("おじぎ"),
    );
    expect(nameHash(" 인사 ")).toBe(nameHash("인사"));
  });

  it("predict the backend entry name, or null when it would be rejected", () => {
    expect(contentEntryName("Heart Hands")).toBe("heart-hands");
    expect(contentEntryName("Café")).toBe("cafe");
    expect(contentEntryName("!!!")).toBeNull();
    expect(contentEntryName("../x")).toBeNull();
  });

  it("are stable for the same name in any Unicode normalization form", () => {
    const composed = "ガ";
    const decomposed = composed.normalize("NFD");
    expect(nameHash(decomposed)).toBe(nameHash(composed));
    expect(gestureSemanticKey(decomposed)).toBe(gestureSemanticKey(composed));
  });

  it("match the shared fixture used by the backend", () => {
    for (const row of fixture.names) {
      expect(nameHash(row.name), row.name).toBe(row.hash);
      expect(gestureSemanticKey(row.name), row.name).toBe(row.semanticKey);
      expect(contentSlug(row.name), row.name).toBe(row.slug);
      expect(contentEntryName(row.name), row.name).toBe(row.entryName);
    }
  });
});
