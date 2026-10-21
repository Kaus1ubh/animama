// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as AppLayoutRoute } from "./_app";

const fixture = vi.hoisted(() => ({ kind: "hosted" as "hosted" | "local" }));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  Navigate: () => null,
  Outlet: () => <main>Anima route</main>,
  useNavigate: () => vi.fn(),
  useRouterState: () => "/",
}));
vi.mock("@web/app/runtime/RuntimeAdmissionProvider", () => ({
  useRuntimeAdmission: () => ({
    admission: {
      status: "ready",
      onboardingRequired: true,
      capabilities: { runtime_kind: "hosted" },
    },
    composition: { kind: fixture.kind },
    controller: { confirmAge: vi.fn(), signOut: vi.fn() },
  }),
}));
vi.mock("@web/app/local-runtime/LocalRuntimeProvider", () => ({
  useLocalRuntime: () => ({ state: { status: "loading" } }),
}));
vi.mock("@web/app/runtime/route-admission", () => ({
  unavailableRouteReason: () => null,
  unavailableReasonText: () => "",
}));
vi.mock("@/ui/app/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
  useOptionalAppShell: () => null,
}));
vi.mock("@/ui/content-preview/ContentPreviewDockProvider", () => ({
  ContentPreviewDockProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
vi.mock("@/ui/settings/SettingsGate", () => ({
  SettingsGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/ui/settings/DesktopUpdatesPanel", () => ({
  DesktopUpdatesPanel: () => null,
}));
vi.mock("@/ui/sidebar", () => ({ SidebarShell: () => null }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(createElement(AppLayoutRoute.options.component!));
  });
  return container;
}

beforeEach(() => {
  fixture.kind = "hosted";
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("application area 18+ confirmation", () => {
  it("renders the hosted Anima route inert behind the dialog and its beta notice", () => {
    const container = render();
    expect(container.textContent).toContain("Anima route");
    expect(container.querySelector("div.contents")!.hasAttribute("inert")).toBe(
      true,
    );
    expect(document.querySelector('[role="note"]')?.textContent).toContain(
      "beta",
    );
  });

  it("keeps the local gate for a local composition", () => {
    fixture.kind = "local";
    render();
    // Local waits for its own runtime before asking; no hosted notice appears.
    expect(document.querySelector('[role="note"]')).toBeNull();
  });
});
