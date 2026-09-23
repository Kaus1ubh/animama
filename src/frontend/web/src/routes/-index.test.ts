import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as HomeRoute } from "./index";
import { Route as ChatLaunchRoute } from "./a/index";

type RedirectProps = {
  to: string;
  params?: { animaId: string };
  replace?: boolean;
  ignoreBlocker?: boolean;
};
const fixture = vi.hoisted(() => ({
  navigate: vi.fn<(props: RedirectProps) => void>(),
  ready: true,
  firstRunComplete: true,
}));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Navigate: (props: RedirectProps) => {
    fixture.navigate(props);
    return null;
  },
}));
vi.mock("@web/app/local-runtime/LocalRuntimeProvider", async (original) => ({
  ...(await original<
    typeof import("@web/app/local-runtime/LocalRuntimeProvider")
  >()),
  useLocalRuntime: () => ({
    state: fixture.ready
      ? { status: "ready", firstRunComplete: fixture.firstRunComplete }
      : { status: "loading" },
  }),
}));
vi.mock("@/query/hooks/useAnimas", () => ({
  useAnimas: () => ({
    isSuccess: true,
    data: [{ id: "annie" }, { id: "janna" }],
  }),
}));
vi.mock("@/query/hooks/useUserSettings", () => ({
  useUserSettings: () => ({
    isSuccess: true,
    data: { last_active_anima_id: "janna" },
  }),
}));

beforeEach(() => {
  fixture.navigate.mockClear();
  fixture.ready = true;
  fixture.firstRunComplete = true;
});
afterEach(() => vi.unstubAllGlobals());

describe("home entry navigation", () => {
  it("waits for local readiness and sends incomplete installations to setup", () => {
    fixture.ready = false;
    renderToStaticMarkup(createElement(HomeRoute.options.component!));
    expect(fixture.navigate).not.toHaveBeenCalled();
    fixture.ready = true;
    fixture.firstRunComplete = false;
    renderToStaticMarkup(createElement(HomeRoute.options.component!));
    expect(fixture.navigate).toHaveBeenCalledWith({
      to: "/setup",
      replace: true,
      ignoreBlocker: true,
    });
  });

  it("finishes an approved home-to-chat redirect while the departed creator blocker awaits cleanup", async () => {
    // TanStack's browser history invokes blockers only with a document present.
    vi.stubGlobal("document", {});
    const history = createMemoryHistory({
      initialEntries: ["/a/reactions/new"],
    });
    let approve!: (blocked: boolean) => void;
    const blocker = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        }),
    );
    const unblock = history.block({ blockerFn: blocker });
    try {
      history.push("/");
      expect(blocker).toHaveBeenCalledOnce();
      expect(history.location.pathname).toBe("/a/reactions/new");
      approve(false);
      await vi.waitFor(() => expect(history.location.pathname).toBe("/"));

      // The new route's layout-effect redirects can precede useBlocker's
      // passive cleanup. Keep the real history blocker registered for both.
      for (const route of [HomeRoute, ChatLaunchRoute]) {
        renderToStaticMarkup(createElement(route.options.component!));
        const redirect = fixture.navigate.mock.lastCall![0];
        const destination = redirect.to.replace(
          "$animaId",
          redirect.params?.animaId ?? "",
        );
        history.replace(destination, undefined, {
          ignoreBlocker: redirect.ignoreBlocker,
        });
      }
      expect(history.location.pathname).toBe("/a/janna");
      expect(blocker).toHaveBeenCalledOnce();
    } finally {
      unblock();
    }
  });
});
