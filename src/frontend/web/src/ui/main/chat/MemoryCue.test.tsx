import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    className,
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a
      href={search ? `${to}?${new URLSearchParams(search)}` : to}
      className={className}
    >
      {children}
    </a>
  ),
}));

import type { ChatMemoryCue } from "@animama/product-ui/chat";
import { MemoryCue, MemoryCueDetails } from "./MemoryCue";

const cue: ChatMemoryCue = {
  episode: { text: "They adopted a cat named Miso." },
  memories: { entry_id: "mem-annie", version: 3, excerpt: "- Miso the cat" },
};

describe("memory cue", () => {
  it("is a named button that opens a dialog popover", () => {
    const html = renderToStaticMarkup(
      <MemoryCue cue={cue} animaName="Annie" />,
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Memory updated"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("labels the episode note and MEMORIES.md change and links to the file", () => {
    const html = renderToStaticMarkup(
      <MemoryCueDetails cue={cue} animaName="Annie" />,
    );
    expect(html).toContain("Noted in episodes");
    expect(html).toContain("They adopted a cat named Miso.");
    expect(html).toContain("Added to Annie&#x27;s memories");
    expect(html).toContain("- Miso the cat");
    expect(html).toContain(
      'href="/a/memories?tab=memory&amp;mode=manual&amp;entryId=mem-annie"',
    );
    expect(html).toContain(">Open in Memories<");
  });

  it("says the memories were updated when a change added no text", () => {
    const html = renderToStaticMarkup(
      <MemoryCueDetails
        cue={{
          episode: null,
          memories: { entry_id: "mem-annie", version: 4, excerpt: "" },
        }}
      />,
    );
    expect(html).toContain("Updated this Anima&#x27;s memories");
    expect(html).toContain("No new text was added.");
    expect(html).not.toContain("Noted in episodes");
  });

  it("has no link for an episode note, which has no file of its own yet", () => {
    const html = renderToStaticMarkup(
      <MemoryCueDetails
        cue={{ episode: { text: "Loves tea." }, memories: null }}
        animaName="Annie"
      />,
    );
    expect(html).toContain("Loves tea.");
    expect(html).not.toContain("Open in Memories");
    expect(html).not.toContain("href=");
  });

  it("uses a host command instead of a link when one is supplied", () => {
    const html = renderToStaticMarkup(
      <MemoryCueDetails
        cue={cue}
        animaName="Annie"
        onOpenMemoryEntry={() => undefined}
      />,
    );
    expect(html).toMatch(/<button[^>]*>Open in Memories<\/button>/);
    expect(html).not.toContain("href=");
  });
});
