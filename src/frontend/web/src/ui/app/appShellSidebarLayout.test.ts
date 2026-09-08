import { describe, expect, it } from "vitest";

import { resolveAppShellSidebarLayout } from "./appShellSidebarLayout";

describe("resolveAppShellSidebarLayout", () => {
  it("docks an adaptive Canvas beside an expanded desktop sidebar", () => {
    expect(
      resolveAppShellSidebarLayout({
        behavior: "adaptive-canvas",
        isDesktop: true,
        sidebarOpen: true,
      }),
    ).toEqual({
      "--app-shell-sidebar-inset": "0px",
      marginLeft: "242px",
      width: "calc(100% - 242px)",
    });
  });

  it("lets the compact desktop sidebar overlay an adaptive Canvas", () => {
    expect(
      resolveAppShellSidebarLayout({
        behavior: "adaptive-canvas",
        isDesktop: true,
        sidebarOpen: false,
      }),
    ).toEqual({
      "--app-shell-sidebar-inset": "56px",
      marginLeft: "0px",
      width: "calc(100% - 0px)",
    });
  });

  it("keeps normal pages inset in either desktop sidebar state", () => {
    expect(
      resolveAppShellSidebarLayout({
        behavior: "inset",
        isDesktop: true,
        sidebarOpen: true,
      }),
    ).toEqual({
      "--app-shell-sidebar-inset": "242px",
      marginLeft: "242px",
      width: "calc(100% - 242px)",
    });
    expect(
      resolveAppShellSidebarLayout({
        behavior: "inset",
        isDesktop: true,
        sidebarOpen: false,
      }),
    ).toEqual({
      "--app-shell-sidebar-inset": "56px",
      marginLeft: "56px",
      width: "calc(100% - 56px)",
    });
  });

  it("leaves mobile surfaces full-width beneath the overlay", () => {
    expect(
      resolveAppShellSidebarLayout({
        behavior: "adaptive-canvas",
        isDesktop: false,
        sidebarOpen: true,
      }),
    ).toEqual({
      "--app-shell-sidebar-inset": "0px",
      marginLeft: "0px",
      width: "calc(100% - 0px)",
    });
  });
});
