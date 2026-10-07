import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ParticleVFXCreatorPage } from "./ParticleVFXCreatorPage";

const fixture = vi.hoisted(() => ({
  busy: false,
  blocker: undefined as
    | {
        shouldBlockFn: (location: {
          current: { pathname: string };
          next: { pathname: string };
        }) => boolean;
        enableBeforeUnload: () => boolean;
      }
    | undefined,
  query: { data: undefined, isError: false, isPending: true } as {
    data: unknown;
    isError: boolean;
    isPending: boolean;
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
  useBlocker: (options: typeof fixture.blocker) => {
    fixture.blocker = options;
    return { status: "idle" };
  },
  useNavigate: () => vi.fn(),
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeOwnerId: () => "owner",
}));
vi.mock("@/query/hooks/useEffects", () => ({
  useParticleEffect: () => fixture.query,
}));
vi.mock("./useParticleVFXSave", () => ({
  useParticleVFXSave: () => ({
    recoveryReady: false,
    recovered: false,
    get isBusy() {
      return fixture.busy;
    },
    notices: [],
  }),
}));
vi.mock("@/ui/content-creator/useContentCreatorModelPreview", () => ({
  useContentCreatorModelPreview: () => ({ modelOptions: [] }),
}));

describe("Particle Effect creator item states", () => {
  beforeEach(() => {
    fixture.busy = false;
    fixture.blocker = undefined;
    fixture.query = { data: undefined, isError: false, isPending: true };
  });

  it("shows loading instead of a blank document while the item is read", () => {
    const html = renderToStaticMarkup(
      <ParticleVFXCreatorPage itemId="particle-1" />,
    );
    expect(html).toContain("Loading Particle Effect…");
    expect(html).not.toContain("New Particle FX");
  });

  it("shows the unavailable state for a missing item", () => {
    fixture.query = { data: undefined, isError: true, isPending: false };
    const html = renderToStaticMarkup(
      <ParticleVFXCreatorPage itemId="missing" />,
    );
    expect(html).toContain("Can’t open this Particle Effect");
    expect(html).toContain('href="/library"');
    expect(html).toContain('href="/create"');
    expect(html).not.toContain("New Particle FX");
  });

  it("lets the user leave the unavailable state with an unsaved draft", () => {
    const leave = {
      current: { pathname: "/edit" },
      next: { pathname: "/library" },
    };
    fixture.busy = true;
    renderToStaticMarkup(<ParticleVFXCreatorPage itemId="particle-1" />);
    expect(fixture.blocker?.shouldBlockFn(leave)).toBe(true);

    fixture.query = { ...fixture.query, data: undefined, isError: true };
    renderToStaticMarkup(<ParticleVFXCreatorPage itemId="missing" />);
    expect(fixture.blocker?.shouldBlockFn(leave)).toBe(false);
    expect(fixture.blocker?.enableBeforeUnload()).toBe(false);
  });
});
