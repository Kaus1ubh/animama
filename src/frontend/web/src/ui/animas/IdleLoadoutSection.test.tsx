// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PyAnimaIdle,
  PyIdleMember,
} from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import { IdleLoadoutSection } from "./IdleLoadoutSection";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const playback = vi.hoisted(() => ({
  failNext: false,
  check: vi.fn(async (itemId: string) => {
    if (playback.failNext) {
      playback.failNext = false;
      throw new Error("Service unavailable");
    }
    return itemId === "endless"
      ? { eligible: false, reason: "idle_repetitions_invalid" }
      : { eligible: true };
  }),
}));

vi.mock("@/query/hooks/useIdleGesturePlayback", () => ({
  useIdleGesturePlaybackCheck: () => ({
    known: () => undefined,
    check: playback.check,
  }),
}));

// Render the picker inline so its choices can be exercised without portals.
vi.mock("@/ui/components/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => children,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div data-picker="">{children}</div>
  ),
}));
vi.mock("@/ui/components/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: () => null,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }) => (
    <div role="option" aria-disabled={disabled} onClick={onSelect}>
      {children}
    </div>
  ),
}));

function member(itemId: string, name: string, available = true): PyIdleMember {
  return {
    binding_id: `binding-${itemId}`,
    item_id: itemId,
    name,
    available,
    source: available
      ? { type: "catalog", catalog_item_id: itemId, source: "included" }
      : null,
  };
}

function gesture(itemId: string, name: string): PyGesture {
  return {
    item_id: itemId,
    name,
    description: null,
    origin: "builtin",
    state: "ready",
    revision_sha256: "a".repeat(64),
    source: { type: "catalog", catalog_item_id: itemId, source: "included" },
  } as PyGesture;
}

const idle: PyAnimaIdle = {
  default_pool: [member("sway", "Sway"), member("gone", "Gone", false)],
  cells: [
    { emotion: "joy", intensity: 1, gestures: [] },
    { emotion: "joy", intensity: 2, gestures: [member("wave", "Wave")] },
    { emotion: "joy", intensity: 3, gestures: [] },
    { emotion: "anger", intensity: 1, gestures: [] },
    { emotion: "anger", intensity: 2, gestures: [] },
    { emotion: "anger", intensity: 3, gestures: [] },
  ],
};

let root: Root | null = null;

function render(props: Partial<ComponentProps<typeof IdleLoadoutSection>>) {
  const handlers = {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onPreview: vi.fn(),
    onPreviewAvailable: vi.fn(),
    onRetryAvailable: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <IdleLoadoutSection
        idle={idle}
        available={[
          gesture("sway", "Sway"),
          gesture("nod", "Nod"),
          gesture("endless", "Endless"),
        ]}
        availableLoading={false}
        availableError={false}
        disabled={false}
        busy={false}
        {...handlers}
        {...props}
      />,
    );
  });
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const button = (text: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === text,
    );
  act(() => button("Idle")!.click());
  return { container, byLabel, button, handlers };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  playback.check.mockClear();
});

describe("Idle loadout section", () => {
  it("shows Default members, marks unavailable ones and summarizes emotions", () => {
    const view = render({});
    const defaultPool = view.byLabel("Default")!;
    expect(defaultPool.textContent).toContain("Sway");
    expect(defaultPool.textContent).toContain("Unavailable");
    expect(view.byLabel("Preview Gone")!.hasAttribute("disabled")).toBeTruthy();
    const emotionRow = (emotion: string) =>
      view.container.querySelector<HTMLElement>(
        `[aria-controls="idle-${emotion}-levels"]`,
      )!;
    expect(emotionRow("anger").textContent).toContain("Default only");
    expect(emotionRow("joy").textContent).toContain("1 Gesture");

    act(() => emotionRow("joy").click());
    expect(view.byLabel("Joy · Moderate")!.textContent).toContain("Wave");
    expect(
      view.container.querySelectorAll('[aria-label="Joy · Mild"]'),
    ).toHaveLength(0);
    // Strong plays Moderate's Wave too: shown read-only, removed from Moderate.
    const inherited = view.byLabel("Inherited by Joy · Strong")!;
    expect(inherited.textContent).toContain("Wave");
    expect(inherited.textContent).toContain("from Moderate");
    expect(inherited.querySelector('[aria-label^="Remove"]')).toBeNull();
  });

  it("removes a member, including an unavailable one, by its row", () => {
    const view = render({});
    act(() => view.byLabel("Remove Gone from Default")!.click());
    expect(view.handlers.onRemove).toHaveBeenCalledWith(idle.default_pool![1]);
  });

  it("adds only finite-playback Gestures that are not already in the cell", async () => {
    const view = render({});
    const picker = view.container.querySelector("[data-picker]")!;
    const options = Array.from(picker.querySelectorAll('[role="option"]'));
    // Sway is already in Default, so the Default picker offers the others.
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Nod"),
      expect.stringContaining("Endless"),
    ]);

    await act(async () => (options[1] as HTMLElement).click());
    expect(playback.check).toHaveBeenCalledWith("endless", "a".repeat(64));
    expect(view.handlers.onAdd).not.toHaveBeenCalled();
    expect(picker.textContent).toContain("finite repetition count");

    await act(async () => (options[0] as HTMLElement).click());
    expect(view.handlers.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ key: "default", emotion: null }),
      expect.objectContaining({ item_id: "nod" }),
    );
  });

  it("keeps a Gesture selectable after a failed check, then retries it", async () => {
    const view = render({});
    const picker = view.container.querySelector("[data-picker]")!;
    const nod = () =>
      Array.from(picker.querySelectorAll<HTMLElement>('[role="option"]')).find(
        (option) => option.textContent?.includes("Nod"),
      )!;

    playback.failNext = true;
    await act(async () => nod().click());
    expect(view.handlers.onAdd).not.toHaveBeenCalled();
    expect(nod().textContent).toContain("could not be checked");
    expect(nod().getAttribute("aria-disabled")).toBe("false");

    await act(async () => nod().click());
    expect(playback.check).toHaveBeenCalledTimes(2);
    expect(view.handlers.onAdd).toHaveBeenCalledOnce();
    // The passed retry replaces the failure message.
    expect(nod().textContent).not.toContain("could not be checked");
  });

  it("keeps Add focusable while a change applies, but blocks choices and Remove", async () => {
    const view = render({ busy: true });
    const add = view.byLabel("Add an idle Gesture to Default")!;
    expect(add.hasAttribute("disabled")).toBe(false);
    const options = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        '[data-picker] [role="option"]',
      ),
    );
    expect(options.length).toBeGreaterThan(0);
    expect(
      options.every(
        (option) => option.getAttribute("aria-disabled") === "true",
      ),
    ).toBe(true);
    expect(
      view.byLabel("Remove Gone from Default")!.hasAttribute("disabled"),
    ).toBe(true);
  });
});
