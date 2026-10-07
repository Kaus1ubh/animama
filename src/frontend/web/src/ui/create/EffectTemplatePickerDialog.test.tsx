// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EffectTemplatePickerDialog } from "./EffectTemplatePickerDialog";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    className,
  }: {
    children: ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <a href="#creator" className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof EffectTemplatePickerDialog>[0];

function mount(props: Props) {
  const opener = document.createElement("button");
  opener.textContent = "Open";
  document.body.append(opener);
  const container = document.createElement("div");
  document.body.append(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<EffectTemplatePickerDialog {...props} />);
  });
  return {
    opener,
    rerender: (next: Props) =>
      act(() => root.render(<EffectTemplatePickerDialog {...next} />)),
    unmount: () => {
      act(() => root.unmount());
      opener.remove();
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("EffectTemplatePickerDialog focus", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("returns focus to the named opener when dismissed", async () => {
    let opener: HTMLButtonElement | null = null;
    const base: Props = {
      open: true,
      onOpenChange: vi.fn(),
      returnFocus: () => opener,
    };
    const view = mount(base);
    opener = view.opener;
    cleanup = view.unmount;
    await flush();
    expect(document.activeElement).not.toBe(opener);

    view.rerender({ ...base, open: false });
    await flush();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves focus to the route after a starting point is chosen", async () => {
    let opener: HTMLButtonElement | null = null;
    const onChoose = vi.fn();
    const base: Props = {
      open: true,
      initialKind: "particle",
      onOpenChange: vi.fn(),
      onChoose,
      returnFocus: () => opener,
    };
    const view = mount(base);
    opener = view.opener;
    cleanup = view.unmount;
    await flush();
    const scratch = [...document.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Start from scratch"),
    );
    act(() => scratch!.click());
    expect(onChoose).toHaveBeenCalledOnce();

    view.rerender({ ...base, open: false });
    await flush();
    expect(document.activeElement).not.toBe(opener);
  });
});
