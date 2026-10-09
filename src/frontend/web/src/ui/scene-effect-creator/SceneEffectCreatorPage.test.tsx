import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SceneEffectCreatorPage } from "./SceneEffectCreatorPage";

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
  query: { data: undefined, isError: false } as {
    data: unknown;
    isError: boolean;
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
  useRuntimeCacheKey: () => "fixture-session",
}));
vi.mock("@/query/hooks/useEffects", () => ({
  useSceneEffect: () => fixture.query,
  useSoundEffects: () => ({ data: undefined }),
}));
vi.mock("@/ui/content-preview/useContentPreviewAudio", () => ({
  useContentPreviewAudio: () => ({}),
}));
vi.mock("./useSceneEffectSave", () => ({
  useSceneEffectSave: () => ({
    recoveryReady: false,
    recovered: false,
    get isBusy() {
      return fixture.busy;
    },
  }),
}));
vi.mock("@/ui/content-creator/useContentCreatorModelPreview", () => ({
  useContentCreatorModelPreview: () => ({ modelOptions: [] }),
}));

describe("Scene Effect creator item states", () => {
  beforeEach(() => {
    fixture.busy = false;
    fixture.blocker = undefined;
    fixture.query = { data: undefined, isError: false };
  });

  it("shows loading while the item is read", () => {
    const html = renderToStaticMarkup(
      <SceneEffectCreatorPage itemId="effect-1" />,
    );
    expect(html).toContain("Loading Scene Effect…");
  });

  it("shows the unavailable state instead of loading forever for a missing item", () => {
    fixture.query = { data: undefined, isError: true };
    const html = renderToStaticMarkup(
      <SceneEffectCreatorPage itemId="missing" />,
    );
    expect(html).not.toContain("Loading Scene Effect…");
    expect(html).toContain("Can’t open this Scene Effect");
    expect(html).toContain('href="/library"');
    expect(html).toContain('href="/create"');
  });

  it("shows the unavailable state for an unreadable item", () => {
    fixture.query = {
      data: {
        item_id: "effect-1",
        state: "invalid",
        origin: "owned",
        editable: true,
      },
      isError: false,
    };
    const html = renderToStaticMarkup(
      <SceneEffectCreatorPage itemId="effect-1" />,
    );
    expect(html).toContain("This Scene Effect is unavailable.");
  });

  it("lets the user leave the unavailable state with an unsaved draft", () => {
    const leave = {
      current: { pathname: "/edit" },
      next: { pathname: "/library" },
    };
    fixture.busy = true;
    renderToStaticMarkup(<SceneEffectCreatorPage itemId="effect-1" />);
    expect(fixture.blocker?.shouldBlockFn(leave)).toBe(true);

    fixture.query = { ...fixture.query, data: undefined, isError: true };
    renderToStaticMarkup(<SceneEffectCreatorPage itemId="missing" />);
    expect(fixture.blocker?.shouldBlockFn(leave)).toBe(false);
    expect(fixture.blocker?.enableBeforeUnload()).toBe(false);
  });
});
