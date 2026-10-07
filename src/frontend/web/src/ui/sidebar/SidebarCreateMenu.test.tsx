// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "./Sidebar";
import { SidebarCreateMenu } from "./SidebarCreateMenu";

const picker = vi.hoisted(() => ({
  open: false,
  returnFocus: null as null | (() => HTMLElement | null),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => {
    const attributes = Object.fromEntries(
      Object.entries(props).filter(([key]) => key !== "to" && key !== "search"),
    );
    return (
      <a href="#" {...attributes}>
        {children}
      </a>
    );
  },
  useLocation: () => "/library",
}));
vi.mock("@/ui/components/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/ui/app/RuntimeFeatureGate", () => ({
  useRuntimeFeatureEnabled: () => true,
}));
vi.mock("@/ui/create/EffectTemplatePickerDialog", () => ({
  EffectTemplatePickerDialog: ({
    open,
    returnFocus,
  }: {
    open: boolean;
    returnFocus?: () => HTMLElement | null;
  }) => {
    picker.open = open;
    picker.returnFocus = returnFocus ?? null;
    return null;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mount(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 768px)" && width >= 768,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const setOpen = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <SidebarProvider open setOpen={setOpen}>
        <SidebarCreateMenu />
      </SidebarProvider>,
    );
  });
  const effects = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ).find((item) => item.textContent?.includes("Effects"));
  const trigger = container.querySelector<HTMLElement>(
    '[aria-label="Create"][aria-haspopup="menu"]',
  )!;
  return {
    setOpen,
    trigger,
    clickEffects: () => act(() => effects!.click()),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("sidebar Create menu Effects item", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    picker.open = false;
    picker.returnFocus = null;
    vi.unstubAllGlobals();
  });

  it("closes the mobile drawer before opening the picker over the page", () => {
    const view = mount(760);
    cleanup = view.unmount;
    view.clickEffects();
    expect(view.setOpen).toHaveBeenCalledWith(false);
    expect(picker.open).toBe(true);
  });

  it("leaves the desktop sidebar as it is", () => {
    const view = mount(1440);
    cleanup = view.unmount;
    view.clickEffects();
    expect(view.setOpen).not.toHaveBeenCalled();
    expect(picker.open).toBe(true);
  });

  it("keeps the menu closed while focus returned by the picker stays on Create", () => {
    const view = mount(1440);
    cleanup = view.unmount;
    view.clickEffects();
    let returned: HTMLElement | null | undefined;
    act(() => {
      returned = picker.returnFocus?.();
    });
    expect(returned).toBe(view.trigger);
    // The returned focus may arrive more than once; none of it reopens the menu.
    act(() => view.trigger.focus());
    act(() =>
      view.trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true })),
    );
    expect(view.trigger.getAttribute("aria-expanded")).toBe("false");
    // Focus that arrives after leaving the trigger opens the menu again.
    act(() => view.trigger.blur());
    act(() => view.trigger.focus());
    expect(view.trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
