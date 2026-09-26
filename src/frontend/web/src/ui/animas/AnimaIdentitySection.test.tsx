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

import { AnimaIdentitySection } from "./AnimaIdentitySection";

const identityProps = {
  animaId: "annie",
  identity: "# **Annie**\n\nA friendly companion.",
  identityLoading: false,
  identityError: false,
  fallbackIdentity: "# Annie\n\nStarter description.",
};

describe("AnimaIdentitySection plain presentation", () => {
  it("renders the complete markdown without an inner scroll surface", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} presentation="plain" />,
    );
    expect(html).toContain("<h1><strong>Annie</strong></h1>");
    expect(html).not.toContain("overflow-auto");
    expect(html).not.toContain("absolute");
    expect(html).toContain("A friendly companion.");
    expect(html).toContain("Edit identity");
    expect(html).not.toMatch(/<h2[^>]*>Identity<\/h2>/);
  });

  it("preserves the management panel by default", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} />,
    );
    expect(html).toContain("<h1><strong>Annie</strong></h1>");
    expect(html).toContain("overflow-auto");
    expect(html).not.toMatch(/<h2[^>]*>Identity<\/h2>/);
  });

  it("preserves loading and starter fallback when the identity cannot load", () => {
    const loading = renderToStaticMarkup(
      <AnimaIdentitySection
        {...identityProps}
        presentation="plain"
        identityLoading
      />,
    );
    expect(loading).toContain("Loading identity…");
    expect(loading).not.toMatch(/<h2[^>]*>Identity<\/h2>/);
    expect(loading).not.toContain("A friendly companion.");
    const failed = renderToStaticMarkup(
      <AnimaIdentitySection
        {...identityProps}
        presentation="plain"
        identityError
      />,
    );
    expect(failed).toContain("could not be loaded");
    expect(failed).toContain("Starter description.");
    expect(failed).toContain("<h1>Annie</h1>");
    expect(failed).toContain("Edit identity");
  });
});

describe("identity edit action", () => {
  it("uses a real button with no navigation when a local editor callback is supplied", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} onEdit={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).not.toContain("<a ");
    expect(html).toContain("Edit identity");
  });
  it("retains the identity route link when there is no override", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} />,
    );
    expect(html).toContain('href="/a/animas/$animaId/identity?tab=overview"');
  });
});

describe("Anima memories link", () => {
  it("opens MEMORIES.md in the Manual memory workspace by entry ID", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} memoriesEntryId="memories-1" />,
    );
    expect(html).toContain(
      'href="/a/memories?tab=memory&amp;mode=manual&amp;entryId=memories-1"',
    );
    expect(html).toContain("Open memories");
    expect(html).toContain("Edit identity");
  });

  it("is omitted while the file is unknown or missing", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} memoriesEntryId={null} />,
    );
    expect(html).not.toContain("Open memories");
    expect(html).not.toContain("/a/memories");
  });
});
