// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdmissionScreen } from "./AdmissionScreen";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function render(props: Partial<ComponentProps<typeof AdmissionScreen>>) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <AdmissionScreen
        admission={{ status: "restricted" }}
        hosted
        retry={vi.fn()}
        {...props}
      />,
    );
  });
  const button = (name: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === name,
    );
  return { container, button };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("AdmissionScreen", () => {
  it("shows the hosted Account control only when account access is available", () => {
    const openAccount = vi.fn();
    const available = render({ openAccount, signOut: vi.fn() });
    act(() => available.button("Account")!.click());
    expect(openAccount).toHaveBeenCalledOnce();
    act(() => root?.unmount());

    const absent = render({ signOut: vi.fn() });
    expect(absent.button("Account")).toBeUndefined();
    expect(absent.button("Sign out")).toBeDefined();
    expect(absent.container.textContent).not.toContain("unavailable");
  });

  it("offers to retry an unfinished sign-out before signing in again", () => {
    const retry = vi.fn();
    const signIn = vi.fn();
    const view = render({
      admission: { status: "sign-in-required" },
      signOutIncomplete: true,
      retry,
      signIn,
    });
    expect(view.container.querySelector("h1")!.textContent).toBe(
      "Sign-out did not complete",
    );
    act(() => view.button("Try again")!.click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => view.button("Sign in")!.click());
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("announces a sign-in problem as an alert beside the sign-in explanation", () => {
    const view = render({
      admission: {
        status: "sign-in-required",
        message: "Sign-in did not finish. Please try again.",
      },
      signIn: vi.fn(),
    });
    expect(view.container.querySelector('[role="alert"]')!.textContent).toBe(
      "Sign-in did not finish. Please try again.",
    );
    expect(view.container.textContent).toContain(
      "Sign in to access your Animas, chats and Library.",
    );
    expect(view.button("Sign in")).toBeDefined();
  });
});
