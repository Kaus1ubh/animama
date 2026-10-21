import { createElement } from "react";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmptyAnimaRoster } from "./EmptyAnimaRoster";

const fixture = vi.hoisted(() => ({ setupPending: false }));

vi.mock("@web/app/runtime/RuntimeAdmissionProvider", () => ({
  useOptionalRuntimeSetupPending: () => fixture.setupPending,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: unknown }) => children,
}));

beforeEach(() => {
  fixture.setupPending = false;
});

describe("empty Anima roster", () => {
  it("waits for the starter Animas while the server prepares them", () => {
    fixture.setupPending = true;
    const markup = renderToStaticMarkup(createElement(EmptyAnimaRoster));
    expect(markup).toContain("Your Animas are being prepared.");
    expect(markup).not.toContain("Your Animas will appear here");
    // The narrow layout keeps its way out while it waits.
    expect(markup).toContain("Open Library");
    expect(markup).toContain("Menu");
  });

  it("explains an empty account once setup has finished", () => {
    const markup = renderToStaticMarkup(createElement(EmptyAnimaRoster));
    expect(markup).toContain("Your Animas will appear here");
  });
});
