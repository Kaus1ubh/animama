import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route } from "@/routes/_app/index";

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  animas: {
    data: [{ id: "annie" }, { id: "caitlyn" }],
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  settings: {
    data: { last_active_anima_id: null as string | null },
    isSuccess: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Navigate: (props: unknown) => {
    fixture.navigate(props);
    return null;
  },
}));
vi.mock("@/query/hooks/useAnimas", () => ({ useAnimas: () => fixture.animas }));
vi.mock("@/query/hooks/useUserSettings", () => ({
  useUserSettings: () => fixture.settings,
}));

function renderLaunch() {
  return renderToStaticMarkup(createElement(Route.options.component!));
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.animas.data = [{ id: "annie" }, { id: "caitlyn" }];
  fixture.settings.data = { last_active_anima_id: null };
  for (const query of [fixture.animas, fixture.settings]) {
    query.isSuccess = true;
    query.isError = false;
    query.isFetching = false;
  }
});

describe("chat launch", () => {
  it("opens the first owned Anima after fresh setup", () => {
    renderLaunch();
    expect(fixture.navigate).toHaveBeenCalledWith({
      to: "/$animaId",
      params: { animaId: "annie" },
      replace: true,
      ignoreBlocker: true,
    });
  });

  it("opens the last visited owned Anima on later launches", () => {
    fixture.settings.data.last_active_anima_id = "caitlyn";
    renderLaunch();
    expect(fixture.navigate).toHaveBeenCalledWith({
      to: "/$animaId",
      params: { animaId: "caitlyn" },
      replace: true,
      ignoreBlocker: true,
    });
  });

  it("falls back if the remembered Anima was deleted or is not owned", () => {
    fixture.settings.data.last_active_anima_id = "missing";
    renderLaunch();
    expect(fixture.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { animaId: "annie" } }),
    );
  });

  it.each(["animas", "settings"] as const)(
    "waits for %s before choosing an Anima",
    (query) => {
      fixture[query].isSuccess = false;
      expect(renderLaunch()).toContain("Opening your Anima");
      expect(fixture.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["animas", "settings"] as const)(
    "offers retry when %s failed instead of overwriting selection",
    (query) => {
      fixture[query].isSuccess = false;
      fixture[query].isError = true;
      expect(renderLaunch()).toContain("Retry");
      expect(fixture.navigate).not.toHaveBeenCalled();
    },
  );

  it("opens creation if no owned Animas remain", () => {
    fixture.animas.data = [];
    renderLaunch();
    expect(fixture.navigate).toHaveBeenCalledWith({
      to: "/animas/new",
      replace: true,
      ignoreBlocker: true,
    });
  });
});
