// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PyReactionCell,
  PyReactionMember,
} from "@animama/runtime-contracts/api-types";
import type { PyReaction } from "@/lib/content/catalogTypes";
import { buildReactionLoadoutGrid } from "@/lib/loadout/reactionLoadoutGrid";
import { ReactionLoadoutGrid } from "./ReactionLoadoutGrid";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Render pickers and menus inline so their items can be exercised without portals.
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
vi.mock("@/ui/components/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-menu="">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <div role="menuitem" aria-disabled={disabled} onClick={onSelect}>
      {children}
    </div>
  ),
}));
vi.mock("@/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

function member(
  itemId: string,
  name: string,
  overrides: Partial<PyReactionMember> = {},
): PyReactionMember {
  return {
    binding_id: `binding-${itemId}`,
    item_id: itemId,
    name,
    available: true,
    origin: "custom",
    source: { type: "catalog", catalog_item_id: itemId, source: "local" },
    ...overrides,
  };
}

function reaction(
  itemId: string,
  name: string,
  origin: PyReaction["origin"],
  suggestion: Pick<PyReaction, "emotion" | "intensity"> = {},
): PyReaction {
  return {
    item_id: itemId,
    name,
    description: null,
    origin,
    state: "ready",
    created_at: null,
    updated_at: null,
    source: { type: "catalog", catalog_item_id: itemId, source: "local" },
    ...suggestion,
  } as PyReaction;
}

/** Admiration is first alphabetically, so it starts expanded. */
const cells: PyReactionCell[] = [
  { emotion: "admiration", intensity: 1, state: "empty", members: [] },
  {
    emotion: "admiration",
    intensity: 2,
    state: "starter",
    members: [member("starter-2", "Admiration 2", { origin: "starter" })],
  },
  {
    emotion: "admiration",
    intensity: 3,
    state: "custom",
    members: [
      member("cheer", "Cheer"),
      member("gone", "Gone", { available: false, source: null }),
    ],
  },
  {
    emotion: "admiration",
    intensity: 4,
    state: "custom",
    members: ["a", "b", "c", "d"].map((id) => member(id, id.toUpperCase())),
  },
];

let root: Root | null = null;

function render(props: Partial<ComponentProps<typeof ReactionLoadoutGrid>>) {
  const handlers = {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onRestoreStarter: vi.fn(),
    onPreview: vi.fn(),
    onPreviewAvailable: vi.fn(),
    onRetryAvailable: vi.fn(),
  };
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <ReactionLoadoutGrid
        rows={buildReactionLoadoutGrid(cells)}
        available={[
          reaction("cheer", "Cheer", "owned", {
            emotion: "joy",
            intensity: 2,
          }),
          reaction("wink", "Wink", "owned"),
          reaction("starter-2", "Admiration 2", "builtin"),
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
  act(() =>
    Array.from(container.querySelectorAll("button"))
      .find((item) => item.textContent?.trim() === "Reactions")!
      .click(),
  );
  /** The cell row holding the element with this accessible name. */
  const row = (label: string) =>
    byLabel(label)!.closest<HTMLElement>(".border-b")!;
  const options = (cellAdd: string) =>
    Array.from(
      row(cellAdd).querySelectorAll<HTMLElement>(
        '[data-picker] [role="option"]',
      ),
    );
  const menuItems = (cellAdd: string) =>
    Array.from(
      row(cellAdd).querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent?.trim());
  return { container, byLabel, row, options, menuItems, handlers };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Reaction loadout pools", () => {
  it("lists four intensities, each with its members, Starter badges and unavailable marks", () => {
    const view = render({});
    const region = view.byLabel("admiration Reaction levels")!;
    expect(
      Array.from(region.querySelectorAll("span"))
        .map((span) => span.textContent)
        .filter((text) =>
          ["Mild", "Moderate", "Strong", "Intense"].includes(text!),
        ),
    ).toEqual(["Mild", "Moderate", "Strong", "Intense"]);
    expect(region.textContent).toContain("No Reaction");

    const starter = view.byLabel("Admiration · Moderate")!;
    expect(starter.textContent).toContain("Admiration 2");
    expect(starter.querySelector('[aria-label="Starter"]')).not.toBeNull();
    const custom = view.byLabel("Admiration · Strong")!;
    expect(custom.querySelector('[aria-label="Starter"]')).toBeNull();
    expect(custom.textContent).toContain("Unavailable");
    expect(view.byLabel("Preview Gone")!.hasAttribute("disabled")).toBe(true);
    // The collapsed summary counts members across the emotion's cells.
    expect(
      view.container.querySelector(
        '[aria-controls="reaction-admiration-levels"]',
      )!.textContent,
    ).toContain("7 Reactions");
  });

  it("removes a member, including an unavailable one", () => {
    const view = render({});
    act(() => view.byLabel("Remove Gone from Admiration · Strong")!.click());
    expect(view.handlers.onRemove).toHaveBeenCalledWith(cells[2]!.members![1]);
  });

  it("marks Reactions already in the cell and adds others to that cell", () => {
    const view = render({});
    const options = view.options("Add a Reaction to Admiration · Strong");
    const cheer = options.find((option) =>
      option.textContent?.includes("Cheer"),
    )!;
    expect(cheer.textContent).toContain("Already in this cell");
    expect(cheer.getAttribute("aria-disabled")).toBe("true");
    // A Reaction's own suggestion stays a hint; it may join any cell.
    expect(cheer.textContent).toContain("joy · Moderate");

    const wink = options.find((option) =>
      option.textContent?.includes("Wink"),
    )!;
    expect(wink.getAttribute("aria-disabled")).toBe("false");
    act(() => wink.click());
    expect(view.handlers.onAdd).toHaveBeenCalledWith(
      cells[2],
      expect.objectContaining({ item_id: "wink" }),
    );
  });

  it("disables Add at four members and says why", () => {
    const view = render({});
    const add = view.byLabel("Add a Reaction to Admiration · Intense")!;
    expect(add.hasAttribute("disabled")).toBe(true);
    const reason = view.container.querySelector(
      `#${add.getAttribute("aria-describedby")}`,
    );
    expect(reason?.textContent).toContain("holds four Reactions");
    expect(
      view
        .byLabel("Add a Reaction to Admiration · Strong")!
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers Restore starter only away from the starter pool, never Leave empty", () => {
    const view = render({});
    const moderate = "Add a Reaction to Admiration · Moderate";
    const strong = "Add a Reaction to Admiration · Strong";
    expect(view.menuItems(moderate)).toEqual(["Choose from Library"]);
    expect(view.menuItems(strong)).toEqual([
      "Choose from Library",
      "Restore starter",
    ]);
    expect(view.menuItems("Add a Reaction to Admiration · Mild")).toContain(
      "Restore starter",
    );
    expect(view.container.textContent).not.toContain("Leave empty");

    act(() =>
      Array.from(
        view.row(strong).querySelectorAll<HTMLElement>('[role="menuitem"]'),
      )
        .find((item) => item.textContent === "Restore starter")!
        .click(),
    );
    expect(view.handlers.onRestoreStarter).toHaveBeenCalledWith(cells[2]);
  });

  it("keeps Add focusable while a change applies, but blocks choices, Remove and Restore", () => {
    const view = render({ busy: true });
    const add = "Add a Reaction to Admiration · Strong";
    expect(view.byLabel(add)!.hasAttribute("disabled")).toBe(false);
    expect(
      view
        .options(add)
        .every((option) => option.getAttribute("aria-disabled") === "true"),
    ).toBe(true);
    expect(
      view
        .byLabel("Remove Cheer from Admiration · Strong")!
        .hasAttribute("disabled"),
    ).toBe(true);
    const restore = Array.from(
      view.row(add).querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Restore starter")!;
    expect(restore.getAttribute("aria-disabled")).toBe("true");
  });
});
