import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
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
  displayName: "Annie",
};

describe("AnimaIdentitySection plain presentation", () => {
  it("uses plain markdown without a duplicate heading or inner scroll surface", () => {
    const html = renderToStaticMarkup(
      <AnimaIdentitySection {...identityProps} presentation="plain" />,
    );
    expect(html).not.toContain("<h1>");
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
    expect(failed).not.toContain("<h1>");
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
    expect(html).toContain('href="/a/animas/$animaId/identity"');
  });
});
