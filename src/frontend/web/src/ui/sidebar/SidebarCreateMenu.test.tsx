// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "./Sidebar";
import { SidebarCreateMenu } from "./SidebarCreateMenu";

const picker = vi.hoisted(() => ({
  open: false,
  returnFocus: null as null | (() => HTMLElement | null),
}));
/** Radix's dismissal callback (outside pointer or focus, Escape). */
const popover = vi.hoisted(() => ({
  onOpenChange: null as null | ((open: boolean) => void),
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
  Popover: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => {
    popover.onOpenChange = onOpenChange ?? null;
    return <>{children}</>;
  },
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  // Radix keeps closed content mounted for its exit animation. Always render
  // it, with its DOM handlers, so events can reach a closing menu.
  PopoverContent: ({
    children,
    id,
    role,
    "aria-label": label,
    onMouseEnter,
    onMouseLeave,
    onFocusCapture,
    onBlurCapture,
  }: ComponentProps<"div">) => (
    <div
      id={id}
      role={role}
      aria-label={label}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      {children}
    </div>
  ),
}));
vi.mock("@/ui/app/RuntimeFeatureGate", () => ({
  useRuntimeFeatureEnabled: () => true,
  useRuntimeFeatureUnavailableReason: () => null,
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
  const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
  return {
    setOpen,
    trigger,
    menu,
    effects: effects!,
    expanded: () => trigger.getAttribute("aria-expanded"),
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
    popover.onOpenChange = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("keeps the open menu open while the pointer moves from Create onto it", () => {
    vi.useFakeTimers();
    const view = mount(1440);
    cleanup = view.unmount;
    const anchor = view.trigger.parentElement!;
    act(() => enter(anchor));
    expect(view.expanded()).toBe("true");
    act(() => leave(anchor, view.menu));
    act(() => enter(view.menu, anchor));
    act(() => vi.advanceTimersByTime(1000));
    expect(view.expanded()).toBe("true");
  });

  it("reopens when the pointer reaches the menu after a hover close", () => {
    vi.useFakeTimers();
    const view = mount(1440);
    cleanup = view.unmount;
    const anchor = view.trigger.parentElement!;
    act(() => enter(anchor));
    act(() => leave(anchor));
    // A slow diagonal path lets the close delay elapse before the pointer
    // arrives over the menu, which is still animating out.
    act(() => vi.advanceTimersByTime(1000));
    expect(view.expanded()).toBe("false");
    act(() => enter(view.menu));
    expect(view.expanded()).toBe("true");
  });

  it("keeps a menu that Radix dismissed closed while it animates out", () => {
    const view = mount(1440);
    cleanup = view.unmount;
    act(() => enter(view.trigger.parentElement!));
    expect(view.expanded()).toBe("true");
    act(() => popover.onOpenChange?.(false));
    expect(view.expanded()).toBe("false");
    act(() => enter(view.menu));
    expect(view.expanded()).toBe("false");
  });

  it("does not reopen when the pointer or focus reaches the closing menu", () => {
    const view = mount(1440);
    cleanup = view.unmount;
    act(() => view.trigger.focus());
    expect(view.expanded()).toBe("true");
    view.clickEffects();
    expect(view.expanded()).toBe("false");
    // A quickly dismissed picker uncovers the menu while it is still exiting,
    // under a pointer that has not moved since choosing Effects.
    act(() => enter(view.menu));
    act(() => view.effects.focus());
    expect(view.expanded()).toBe("false");
  });
});

/** React derives enter and leave from `mouseover`/`mouseout` pairs. */
function enter(target: HTMLElement, from: HTMLElement | null = null) {
  target.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }),
  );
}

function leave(target: HTMLElement, to: HTMLElement | null = null) {
  target.dispatchEvent(
    new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }),
  );
}
