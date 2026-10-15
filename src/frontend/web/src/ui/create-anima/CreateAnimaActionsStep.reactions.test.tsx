// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PyReaction } from "@animama/runtime-contracts/sdk";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import { CreateAnimaActionsStep } from "./CreateAnimaActionsStep";
import {
  createAnimaDraftReducer,
  newCreateAnimaDraft,
  setReactionPool,
  type CreateAnimaDraft,
} from "./createAnimaDraft";
import { creationOptions, ref } from "./createAnimaTestFixtures";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Render pickers inline so their choices can be exercised without portals.
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
  CommandGroup: ({
    children,
    heading,
  }: {
    children: ReactNode;
    heading: string;
  }) => <div data-group={heading}>{children}</div>,
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
vi.mock("@/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

function reaction(
  itemId: string,
  name: string,
  source: PyReaction["source"],
  suggestion: Pick<PyReaction, "emotion" | "intensity"> = {},
): PyReaction {
  return {
    item_id: itemId,
    name,
    source,
    revision_sha256: "a".repeat(64),
    editable: source === "local",
    implementation: { kind: "anima_clip" },
    ...suggestion,
  } as PyReaction;
}

const catalog = [
  reaction("adm-2", "Admiration 2", "included", {
    emotion: "admiration",
    intensity: 2,
  }),
  reaction("adm-3", "Admiration 3", "included", {
    emotion: "admiration",
    intensity: 3,
  }),
  reaction("adm-3b", "Admiration 3B", "included", {
    emotion: "admiration",
    intensity: 3,
  }),
  reaction("wink", "Wink", "local"),
];

/** A draft seeded from a Starter Pack with pools at Moderate and Strong. */
function seededDraft(): CreateAnimaDraft {
  const options = creationOptions();
  options.recommended.reactions.admiration["2"] = [ref("adm-2")];
  options.recommended.reactions.admiration["3"] = [ref("adm-3"), ref("adm-3b")];
  return createAnimaDraftReducer(newCreateAnimaDraft(), {
    type: "seed",
    options,
  });
}

let root: Root | null = null;

/** Render the step; `optionsLoaded: false` leaves creation options loading. */
function render(draft: CreateAnimaDraft = seededDraft(), optionsLoaded = true) {
  const options = creationOptions();
  options.recommended.reactions.admiration["2"] = [ref("adm-2")];
  options.recommended.reactions.admiration["3"] = [ref("adm-3"), ref("adm-3b")];
  const sources = {
    options: { data: optionsLoaded ? options : undefined },
    gestures: { data: [], isLoading: false, isError: false },
    reactions: {
      data: catalog,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
  } as unknown as AnimaCreationSources;
  const onEdit = vi.fn();
  const onPreview = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <CreateAnimaActionsStep
        draft={draft}
        sources={sources}
        onEdit={onEdit}
        onReset={vi.fn()}
        onPreview={onPreview}
        focusTarget="creation-reaction-admiration-1"
      />,
    );
  });
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  /** The cell row whose Add button has this accessible name. */
  const row = (add: string) =>
    byLabel(add)!.closest<HTMLElement>("[id^='creation-reaction-']")!;
  const options_ = (add: string) =>
    Array.from(
      row(add).querySelectorAll<HTMLElement>('[data-picker] [role="option"]'),
    );
  const option = (add: string, name: string) =>
    options_(add).find((item) => item.textContent?.includes(name))!;
  /** The pools the last edit submitted. */
  const edited = () =>
    (onEdit.mock.lastCall![0] as Pick<CreateAnimaDraft, "reactions">).reactions;
  return { container, byLabel, row, option, onEdit, onPreview, edited };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Create Anima Reaction pools", () => {
  it("shows four intensity rows per emotion, starting from the starter pools", () => {
    const view = render();
    const region = view.byLabel("Admiration Reaction levels")!;
    expect(
      Array.from(region.querySelectorAll("span"))
        .map((span) => span.textContent)
        .filter((text) =>
          ["Mild", "Moderate", "Strong", "Intense"].includes(text!),
        ),
    ).toEqual(["Mild", "Moderate", "Strong", "Intense"]);
    expect(
      view.row("Add a Reaction to Admiration · Mild").textContent,
    ).toContain("No Reaction");
    const strong = view.byLabel("Admiration · Strong")!;
    expect(strong.textContent).toContain("Admiration 3");
    expect(strong.textContent).toContain("Admiration 3B");
    expect(strong.querySelectorAll('[aria-label="Starter"]')).toHaveLength(2);
    // The collapsed summary counts the emotion's members.
    expect(
      view.container.querySelector(
        '[aria-controls="creation-reaction-admiration-levels"]',
      )!.textContent,
    ).toContain("3 Reactions");
  });

  it("adds a Reaction to one cell's pool, grouped as Local or Included", () => {
    const view = render();
    const add = "Add a Reaction to Admiration · Strong";
    const wink = view.option(add, "Wink");
    expect(wink.closest("[data-group]")!.getAttribute("data-group")).toBe(
      "Local",
    );
    act(() => wink.click());
    const pools = view.edited();
    expect(pools.admiration["3"]).toEqual([
      ref("adm-3"),
      ref("adm-3b"),
      ref("wink"),
    ]);
    // Other cells are untouched.
    expect(pools.admiration["2"]).toEqual([ref("adm-2")]);
  });

  it("refuses a Reaction already in the cell", () => {
    const view = render();
    const add = "Add a Reaction to Admiration · Strong";
    const duplicate = view.option(add, "Admiration 3B");
    expect(duplicate.textContent).toContain("Already in this cell");
    expect(duplicate.getAttribute("aria-disabled")).toBe("true");
    // The same Reaction may still join another cell.
    expect(
      view
        .option("Add a Reaction to Admiration · Mild", "Admiration 3B")
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("removes one member and keeps the others", () => {
    const view = render();
    act(() =>
      view.byLabel("Remove Admiration 3 from Admiration · Strong")!.click(),
    );
    expect(view.edited().admiration["3"]).toEqual([ref("adm-3b")]);
  });

  it("disables Add at four members and says why", () => {
    const draft = seededDraft();
    draft.reactions = setReactionPool(
      draft,
      "admiration",
      "4",
      ["a", "b", "c", "d"].map((id) => ref(id)),
    );
    const view = render(draft);
    const add = view.byLabel("Add a Reaction to Admiration · Intense")!;
    expect(add.hasAttribute("disabled")).toBe(true);
    const reason = document.getElementById(
      add.getAttribute("aria-describedby")!,
    );
    expect(reason?.textContent).toContain("holds four Reactions");
    expect(
      view
        .byLabel("Add a Reaction to Admiration · Strong")!
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("previews a member and a choice without editing the pool", () => {
    const view = render();
    act(() =>
      view
        .byLabel("Admiration · Moderate")!
        .querySelector<HTMLElement>('[aria-label="Preview Admiration 2"]')!
        .click(),
    );
    expect(view.onPreview).toHaveBeenCalledWith(
      "reaction",
      ref("adm-2"),
      "Admiration 2",
    );
    const add = "Add a Reaction to Admiration · Mild";
    act(() =>
      view
        .option(add, "Wink")
        .querySelector<HTMLElement>('[aria-label="Preview Wink"]')!
        .click(),
    );
    expect(view.onPreview).toHaveBeenLastCalledWith(
      "reaction",
      ref("wink"),
      "Wink",
    );
    expect(view.onEdit).not.toHaveBeenCalled();
  });

  it("reverts only a cell that differs from its recommended pool", () => {
    const draft = seededDraft();
    draft.reactions = setReactionPool(draft, "admiration", "1", [ref("wink")]);
    // The same members in another order are still the recommended pool.
    draft.reactions = setReactionPool(draft, "admiration", "3", [
      ref("adm-3b"),
      ref("adm-3"),
    ]);
    const view = render(draft);
    expect(
      view.byLabel("Revert Admiration · Strong to recommended"),
    ).toBeNull();
    act(() => view.byLabel("Revert Admiration · Mild to recommended")!.click());
    expect(view.edited().admiration["1"]).toEqual([]);
  });

  it("offers Revert only once the recommended pools are known", () => {
    const draft = seededDraft();
    draft.reactions = setReactionPool(draft, "admiration", "1", [ref("wink")]);
    const view = render(draft, false);
    // Members still list while creation options load, but no cell can tell
    // whether it differs from its recommended pool.
    expect(view.byLabel("Admiration · Strong")!.textContent).toContain(
      "Admiration 3B",
    );
    expect(view.container.textContent).not.toContain("Revert");
  });

  it("marks a member whose source is missing", () => {
    const draft = seededDraft();
    draft.reactions = setReactionPool(draft, "admiration", "1", [ref("gone")]);
    const view = render(draft);
    const mild = view.byLabel("Admiration · Mild")!;
    expect(mild.textContent).toContain("Needs attention");
    expect(
      view
        .byLabel("Remove gone from Admiration · Mild")!
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
