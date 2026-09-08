import { describe, expect, it } from "vitest";

import {
  adjacentAnimaId,
  animaDetailsSearchFromUrl,
  animaListSearchFromUrl,
  normalizeAnimaDetailsSearch,
  normalizeAnimaListSearch,
  resolveAnimasNavigationTarget,
  resolveFirstOwnedAnimaId,
  resolveNewChatAnimaId,
  resolveSelectedAnimaId,
} from "./anima-management-search";

describe("Anima management search", () => {
  it("keeps a non-empty roster selection and rejects invalid values", () => {
    expect(normalizeAnimaListSearch({ selected: " anima-2 " })).toEqual({
      selected: "anima-2",
    });
    expect(normalizeAnimaListSearch({ selected: "" })).toEqual({});
    expect(normalizeAnimaListSearch({ selected: 42 })).toEqual({});
  });

  it("recovers roster selection from a full-reload URL", () => {
    const url = new URL(
      "http://localhost:5173/a/animas?selected=anima-2&ignored=value",
    );
    expect(animaListSearchFromUrl(url)).toEqual({ selected: "anima-2" });
  });

  it("normalizes management tabs to the typed-only contract", () => {
    expect(normalizeAnimaDetailsSearch({ tab: "emotions" })).toEqual({
      tab: "emotions",
    });
    expect(normalizeAnimaDetailsSearch({ tab: "assets" })).toEqual({
      tab: "overview",
    });
    expect(normalizeAnimaDetailsSearch({ tab: "loadout" })).toEqual({
      tab: "loadout",
    });
    expect(normalizeAnimaDetailsSearch({ tab: "identity" })).toEqual({
      tab: "overview",
    });
    expect(normalizeAnimaDetailsSearch({ tab: "unknown" })).toEqual({
      tab: "overview",
    });
    expect(normalizeAnimaDetailsSearch({})).toEqual({
      tab: "overview",
    });
    expect(normalizeAnimaDetailsSearch({ tab: null })).toEqual({
      tab: "overview",
    });
    expect(normalizeAnimaDetailsSearch({ tab: "overview" })).toEqual({
      tab: "overview",
    });
  });

  it("recovers a valid management tab from a full-reload URL", () => {
    expect(
      animaDetailsSearchFromUrl(
        new URL("http://localhost:5173/a/animas/anima-2"),
      ),
    ).toEqual({ tab: "overview" });
    expect(
      animaDetailsSearchFromUrl(
        new URL("http://localhost:5173/a/animas/anima-2?tab=overview"),
      ),
    ).toEqual({ tab: "overview" });
    expect(
      animaDetailsSearchFromUrl(
        new URL("http://localhost:5173/a/animas/anima-2?tab=assets"),
      ),
    ).toEqual({ tab: "overview" });
    expect(
      animaDetailsSearchFromUrl(
        new URL("http://localhost:5173/a/animas/anima-2?tab=loadout"),
      ),
    ).toEqual({ tab: "loadout" });
    expect(
      animaDetailsSearchFromUrl(
        new URL("http://localhost:5173/a/animas/anima-2?tab=unknown"),
      ),
    ).toEqual({ tab: "overview" });
  });

  it("targets the current Anima from the sidebar or falls back to the resolver", () => {
    expect(resolveAnimasNavigationTarget(" anima-2 ")).toEqual({
      route: "details",
      animaId: "anima-2",
    });
    expect(resolveAnimasNavigationTarget(null)).toEqual({
      route: "resolver",
    });
  });
});

describe("Anima roster selection", () => {
  it("resolves New Chat from the route, remembered Anima, or owned fallback", () => {
    expect(
      resolveNewChatAnimaId("anima-route", "anima-2", ["anima-1", "anima-2"]),
    ).toBe("anima-route");
    expect(resolveNewChatAnimaId(null, "anima-2", ["anima-1", "anima-2"])).toBe(
      "anima-2",
    );
    expect(resolveNewChatAnimaId(null, "stale", ["anima-1", "anima-2"])).toBe(
      "anima-1",
    );
    expect(resolveNewChatAnimaId(null, "anima-1", [])).toBeNull();
  });

  it("uses a valid requested selection even after list reordering", () => {
    expect(resolveSelectedAnimaId(["anima-1", "anima-2"], "anima-2")).toBe(
      "anima-2",
    );
    expect(resolveSelectedAnimaId(["anima-2", "anima-1"], "anima-2")).toBe(
      "anima-2",
    );
  });

  it("falls back for missing, stale, and empty selections", () => {
    expect(resolveSelectedAnimaId(["anima-1", "anima-2"])).toBe("anima-1");
    expect(resolveSelectedAnimaId(["anima-1", "anima-2"], "not-owned")).toBe(
      "anima-1",
    );
    expect(resolveSelectedAnimaId([], "anima-1")).toBeNull();
  });

  it("resolves the compatibility route to the first owned Anima", () => {
    expect(resolveFirstOwnedAnimaId(["anima-2", "anima-1"])).toBe("anima-2");
    expect(resolveFirstOwnedAnimaId([])).toBeNull();
  });

  it("wraps previous and next selection at both ends", () => {
    const ids = ["anima-1", "anima-2", "anima-3"];
    expect(adjacentAnimaId(ids, "anima-1", -1)).toBe("anima-3");
    expect(adjacentAnimaId(ids, "anima-3", 1)).toBe("anima-1");
    expect(adjacentAnimaId(ids, "anima-2", -1)).toBe("anima-1");
    expect(adjacentAnimaId(ids, "anima-2", 1)).toBe("anima-3");
  });

  it("keeps a one-Anima roster stable and handles unresolved lists", () => {
    expect(adjacentAnimaId(["anima-1"], "anima-1", -1)).toBe("anima-1");
    expect(adjacentAnimaId(["anima-1"], "anima-1", 1)).toBe("anima-1");
    expect(adjacentAnimaId([], null, 1)).toBeNull();
    expect(adjacentAnimaId(["anima-1"], "missing", 1)).toBeNull();
  });
});
