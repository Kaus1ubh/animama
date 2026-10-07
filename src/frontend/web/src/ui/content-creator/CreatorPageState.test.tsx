import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CreatorLoadingState, CreatorUnavailableState } from ".";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
}));

describe("creator page states", () => {
  it("announces loading", () => {
    const html = renderToStaticMarkup(
      <CreatorLoadingState message="Loading Particle Effect…" />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading Particle Effect…");
  });

  it("explains an unavailable item and links back to the Library and Create", () => {
    const html = renderToStaticMarkup(
      <CreatorUnavailableState
        label="Scene Effect"
        message="This Scene Effect could not be found."
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Can’t open this Scene Effect");
    expect(html).toContain("This Scene Effect could not be found.");
    expect(html).toContain('href="/library"');
    expect(html).toContain('href="/create"');
  });
});
