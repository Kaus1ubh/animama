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
});
