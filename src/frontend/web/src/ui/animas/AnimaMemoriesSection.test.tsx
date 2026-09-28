import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  identities: vi.fn(),
  entry: vi.fn(),
  repair: vi.fn(),
}));
vi.mock("@/query/hooks/useMemoryEntries", () => ({
  useAnimaIdentities: hooks.identities,
  useMemoryEntry: hooks.entry,
}));
vi.mock("@/query/mutations/useRepairAnimaMemories", () => ({
  useRepairAnimaMemories: hooks.repair,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search: Record<string, string>;
    children: ReactNode;
  }) => <a href={`${to}?${new URLSearchParams(search)}`}>{children}</a>,
}));
import { AnimaMemoriesSection } from "./AnimaMemoriesSection";

const listing = {
  identities: [
    { anima_id: "mika", memories_entry: { id: "mika-memories" } },
    { anima_id: "annie", memories_entry: { id: "annie-memories" } },
  ],
};
const render = () =>
  renderToStaticMarkup(<AnimaMemoriesSection animaId="annie" />);

beforeEach(() => {
  vi.clearAllMocks();
  hooks.identities.mockReturnValue({
    data: listing,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  hooks.entry.mockReturnValue({
    data: { content: "# Memories\n\nWe enjoy **drawing**." },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  hooks.repair.mockReturnValue({
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  });
});

describe("Anima memories document", () => {
  it("renders the selected Anima's file and edits that exact entry in Manual mode", () => {
    const html = render();
    expect(hooks.entry).toHaveBeenCalledWith("annie-memories");
    expect(html).toContain("<h1>Memories</h1>");
    expect(html).toContain("<strong>drawing</strong>");
    expect(html).toContain("Edit memories");
    expect(html).toContain(
      'href="/a/memories?tab=memory&amp;mode=manual&amp;entryId=annie-memories"',
    );
    expect(html).not.toContain("mika-memories");
    expect(html).not.toContain("overflow-auto");
    expect(html).not.toContain("bg-muted/25");
  });
  it.each(["listing", "file"])(
    "shows loading while the %s is pending",
    (pending) => {
      if (pending === "listing")
        hooks.identities.mockReturnValue({ isPending: true });
      else hooks.entry.mockReturnValue({ isPending: true });
      const html = render();
      expect(html).toContain("Loading memories…");
      expect(html).not.toContain("Edit memories");
      expect(html).not.toContain("Repair memories");
    },
  );
  it.each(["listing", "file"])(
    "offers retry when the %s fails instead of claiming memories are empty",
    (failed) => {
      if (failed === "listing")
        hooks.identities.mockReturnValue({ isError: true });
      else hooks.entry.mockReturnValue({ isError: true });
      const html = render();
      expect(html).toContain("could not be loaded");
      expect(html).toContain("Retry");
      expect(html).not.toContain("Repair memories");
    },
  );
  it("allows an empty file to be edited", () => {
    hooks.entry.mockReturnValue({ data: { content: "" } });
    const html = render();
    expect(html).toContain("No memories recorded yet.");
    expect(html).toContain("Edit memories");
  });
  it("offers repair only when this Anima's file is known to be missing", () => {
    hooks.identities.mockReturnValue({
      data: { identities: [{ anima_id: "annie", memories_entry: null }] },
    });
    const html = render();
    expect(hooks.entry).toHaveBeenCalledWith(undefined);
    expect(html).toContain("MEMORIES.md is missing.");
    expect(html).toContain("Repair memories");
    expect(html).not.toContain("Edit memories");
  });
  it.each([{ identities: [] }, {}])(
    "does not offer repair when the listing has no selected Anima: %j",
    (data) => {
      hooks.identities.mockReturnValue({ data });
      const html = render();
      expect(html).toContain("could not be loaded");
      expect(html).not.toContain("Repair memories");
    },
  );
  it("disables repair while pending and shows a failed repair", () => {
    hooks.identities.mockReturnValue({
      data: { identities: [{ anima_id: "annie", memories_entry: null }] },
    });
    hooks.repair.mockReturnValue({ isPending: true });
    expect(render()).toMatch(/<button[^>]*disabled=""/);
    hooks.repair.mockReturnValue({
      isError: true,
      error: new Error("Repair unavailable"),
    });
    expect(render()).toContain("Repair unavailable");
  });
});
