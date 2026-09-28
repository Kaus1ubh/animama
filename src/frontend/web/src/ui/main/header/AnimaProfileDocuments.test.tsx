import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ memories: vi.fn() }));
vi.mock("@/query/hooks/useMemoryEntries", () => ({
  useAnimaMemoriesEntry: hooks.memories,
}));
vi.mock("@/ui/animas/AnimaIdentitySection", () => ({
  AnimaIdentitySection: ({ identity }: { identity: string }) => (
    <p>{identity}</p>
  ),
}));
vi.mock("@/ui/animas/AnimaMemoriesSection", () => ({
  AnimaMemoriesSection: ({ animaId }: { animaId: string }) => (
    <p>Memories for {animaId}</p>
  ),
}));
import { AnimaProfileDocuments } from "./AnimaProfileDocuments";

const props = {
  animaId: "annie",
  identity: "Annie identity",
  identityLoading: false,
  identityError: false,
  fallbackIdentity: "Starter identity",
  onTabChange: vi.fn(),
  onEdit: vi.fn(),
};
beforeEach(() => hooks.memories.mockReturnValue({ id: "annie-memories" }));

describe("profile document tabs", () => {
  it("shows Identity initially with its matching edit action", () => {
    const html = renderToStaticMarkup(
      <AnimaProfileDocuments {...props} tab="identity" />,
    );
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Identity/);
    expect(html).toContain("Annie identity");
    expect(html).toContain("Edit identity");
    expect(html).not.toContain("Edit memories");
    expect(html).not.toContain("Memories for annie");
  });
  it("selects the current Anima's memories with an in-place edit button", () => {
    const html = renderToStaticMarkup(
      <AnimaProfileDocuments {...props} tab="memories" />,
    );
    expect(hooks.memories).toHaveBeenCalledWith("annie");
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Memories/);
    expect(html).toContain("Memories for annie");
    expect(html).toContain("Edit memories");
    expect(html).not.toContain("Edit identity");
    expect(html).not.toContain("Annie identity");
    expect(html).not.toContain("<a ");
  });
  it("disables memories editing until a canonical file is available", () => {
    hooks.memories.mockReturnValue(null);
    const html = renderToStaticMarkup(
      <AnimaProfileDocuments {...props} tab="memories" />,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>.*Edit memories<\/button>/,
    );
  });
});
