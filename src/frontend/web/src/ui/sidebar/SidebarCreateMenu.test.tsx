// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "./Sidebar";
import { SidebarCreateMenu } from "./SidebarCreateMenu";

const picker = vi.hoisted(() => ({ open: false }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
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
  EffectTemplatePickerDialog: ({ open }: { open: boolean }) => {
    picker.open = open;
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
  return {
    setOpen,
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
});
