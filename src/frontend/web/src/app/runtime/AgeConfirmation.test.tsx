// @vitest-environment happy-dom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HostedAgeConfirmation } from "../hosted-runtime/HostedAgeConfirmation";
import { FirstRunAgeConfirmation } from "../local-runtime/setup/FirstRunAgeConfirmation";

const fixture = vi.hoisted(() => ({
  pending: true,
  confirmAge: vi.fn<() => Promise<void>>(),
  signOut: vi.fn<() => Promise<void>>(),
  completeOnboarding: vi.fn(),
  navigate: vi.fn(),
  rerender: () => {},
}));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/safety">{children}</a>
  ),
  Navigate: () => null,
  useNavigate: () => fixture.navigate,
}));
vi.mock("./RuntimeAdmissionProvider", () => ({
  useRuntimeAdmission: () => ({
    admission: { status: "ready", onboardingRequired: fixture.pending },
    controller: { confirmAge: fixture.confirmAge, signOut: fixture.signOut },
  }),
}));
vi.mock("../local-runtime/LocalRuntimeProvider", () => ({
  useLocalRuntime: () => ({
    state: { status: "ready", principalId: "local-owner" },
    completeOnboarding: fixture.completeOnboarding,
  }),
}));
vi.mock("../local-runtime/setup-draft", () => ({
  readSetupDraft: () => ({
    displayName: "Ray",
    awaitingAgeConfirmation: true,
    chatModelId: null,
  }),
  writeSetupDraft: vi.fn(),
  clearSetupDraft: vi.fn(),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ isSuccess: true, isError: false, data: {} }),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mounts = vi.fn();

/** Stands in for the loaded app behind the boundary; counts its mounts. */
function LoadedApp() {
  useEffect(() => mounts(), []);
  return <button type="button">Scene control</button>;
}

function render(Gate: (props: { children: ReactNode }) => ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const draw = () =>
    root!.render(
      <Gate>
        <LoadedApp />
      </Gate>,
    );
  act(() => {
    root = createRoot(container);
    draw();
  });
  fixture.rerender = () => act(draw);
  const button = (name: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent === name,
    );
  const inert = () =>
    container.querySelector("div.contents")!.hasAttribute("inert");
  return { button, inert };
}

beforeEach(() => {
  fixture.pending = true;
  fixture.confirmAge.mockReset().mockResolvedValue();
  fixture.signOut.mockReset().mockResolvedValue();
  fixture.completeOnboarding.mockReset().mockResolvedValue(undefined);
  mounts.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("hosted 18+ confirmation", () => {
  it("shows the shared dialog and the beta notice over the rendered, inert app", () => {
    const view = render(HostedAgeConfirmation);
    expect(view.button("Scene control")).toBeDefined();
    expect(view.inert()).toBe(true);
    expect(document.body.textContent).toContain("Before you start");
    expect(document.querySelector('[role="note"]')?.textContent).toBe(
      "Animama on the web is in beta. The desktop app gives the best experience.",
    );
    // Hosted accounts accept the Terms at sign-up, not here.
    expect(document.body.textContent).not.toContain("Terms of Service");
  });

  it("confirms through the hosted relay and opens the same app without remounting it", async () => {
    const view = render(HostedAgeConfirmation);
    await act(async () => view.button("I am 18 or older")!.click());
    expect(fixture.confirmAge).toHaveBeenCalledOnce();
    fixture.pending = false;
    fixture.rerender();
    expect(view.inert()).toBe(false);
    expect(document.body.textContent).not.toContain("Before you start");
    expect(mounts).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open with its hosted message when the relay fails", async () => {
    fixture.confirmAge.mockRejectedValue(new Error("relay failed"));
    const view = render(HostedAgeConfirmation);
    await act(async () => view.button("I am 18 or older")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Your confirmation could not be saved. Please try again.",
    );
    expect(view.button("I am 18 or older")).toBeDefined();
  });

  it("sends nothing when declined and offers sign-out", async () => {
    const view = render(HostedAgeConfirmation);
    await act(async () => view.button("I'm under 18")!.click());
    expect(document.body.textContent).toContain(
      "Animama is only for adults 18 and older.",
    );
    expect(view.button("Go back")).toBeUndefined();
    await act(async () => view.button("Sign out")!.click());
    expect(fixture.signOut).toHaveBeenCalledOnce();
    expect(fixture.confirmAge).not.toHaveBeenCalled();
  });
});

describe("local first-run confirmation", () => {
  it("keeps local onboarding: no beta notice, the setup draft's answer and a way back", async () => {
    const view = render(FirstRunAgeConfirmation);
    expect(view.inert()).toBe(true);
    expect(document.querySelector('[role="note"]')).toBeNull();
    expect(view.button("Back to setup")).toBeDefined();
    await act(async () => view.button("I'm under 18")!.click());
    expect(view.button("Sign out")).toBeUndefined();
    await act(async () => view.button("Go back")!.click());
    await act(async () => view.button("I am 18 or older and agree")!.click());
    expect(fixture.completeOnboarding).toHaveBeenCalledWith({
      displayName: "Ray",
      adultConfirmed: true,
    });
    expect(fixture.confirmAge).not.toHaveBeenCalled();
  });

  it("asks the owner to agree to the published Terms and Privacy Notice", () => {
    render(FirstRunAgeConfirmation);
    const link = (name: string) =>
      Array.from(document.querySelectorAll("a")).find((item) =>
        item.textContent?.startsWith(name),
      );
    expect(link("Terms of Service")?.getAttribute("href")).toBe(
      "https://animama.ai/terms/",
    );
    expect(link("Privacy Notice")?.getAttribute("href")).toBe(
      "https://animama.ai/privacy/",
    );
    // A new-window request lets the desktop shell open the system browser.
    expect(link("Terms of Service")?.getAttribute("target")).toBe("_blank");
  });
});
