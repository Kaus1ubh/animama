// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PyAnimaLoadout,
  PyReactionCell,
} from "@animama/runtime-contracts/api-types";
import { withRuntime } from "@/test/runtime-markup";
import {
  ActionManageDialog,
  type ManageActionTarget,
} from "./ActionManageDialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  loadouts: new Map<string, unknown>(),
  changeReaction: vi.fn(),
  /** Animas whose `changeReaction` is applying a change. */
  pending: new Set<string>(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  getAnimaLoadoutV1AnimasAnimaIdLoadoutGet: async ({
    path,
  }: {
    path: { anima_id: string };
  }) => ({ data: mocks.loadouts.get(path.anima_id) }),
}));
vi.mock("@/query/hooks/useAnimas", () => ({
  useAnimas: () => ({
    data: [
      { id: "rowan", presentation: { display_name: "Rowan" } },
      { id: "luna", presentation: { display_name: "Luna" } },
      { id: "mira", presentation: { display_name: "Mira" } },
    ],
  }),
}));
// Each Anima's row changes its pool through that Anima's `changeReaction`.
vi.mock("@/query/mutations/useAnimaLoadoutMutations", () => ({
  useAnimaLoadoutMutations: (animaId: string) => ({
    changeReaction: {
      isPending: mocks.pending.has(animaId),
      mutateAsync: (body: unknown) => mocks.changeReaction(animaId, body),
    },
  }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}));
// Render each Select's options inline; choosing one reports its value.
vi.mock("@/ui/components/select", async () => {
  const { createContext, useContext } = await import("react");
  const SelectContext = createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: ReactNode;
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div data-select={value}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children, id }: { children: ReactNode; id?: string }) => (
      <button type="button" role="combobox" id={id}>
        {children}
      </button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) => {
      const select = useContext(SelectContext);
      return (
        <div
          role="option"
          data-value={value}
          aria-selected={select.value === value}
          onClick={() => select.onValueChange?.(value)}
        >
          {children}
        </div>
      );
    },
  };
});

function cell(
  emotion: string,
  intensity: PyReactionCell["intensity"],
  ...itemIds: string[]
): PyReactionCell {
  return {
    emotion,
    intensity,
    state: itemIds.length ? "custom" : "empty",
    members: itemIds.map((itemId) => ({
      binding_id: `${itemId}-binding`,
      item_id: itemId,
      name: itemId,
      available: true,
      origin: "custom",
    })),
  };
}

function loadout(revision: number, reactions: PyReactionCell[]) {
  return { revision, gestures: [], reactions } as unknown as PyAnimaLoadout;
}

const cheer: ManageActionTarget = {
  kind: "reaction",
  itemId: "cheer",
  name: "Cheer",
  description: "",
  source: {
    type: "catalog",
    catalog_item_id: "cheer",
    logical_key: "local:reaction:cheer",
    source: "local",
  },
  emotion: "joy",
  intensity: 4,
};

let root: Root | null = null;

/** Render the dialog; `enabled` row buttons show every Loadout has loaded. */
async function render(target: ManageActionTarget, enabled = 2) {
  // Rowan has Cheer in Joy · Intense; Luna has another Reaction there; Mira's
  // Joy · Intense is full. Rowan also has Cheer in Grief · Moderate.
  mocks.loadouts.set(
    "rowan",
    loadout(3, [
      cell("joy", 4, "other", "cheer"),
      cell("grief", 2, "cheer"),
      cell("joy", 1),
    ]),
  );
  mocks.loadouts.set("luna", loadout(5, [cell("joy", 4, "other")]));
  mocks.loadouts.set("mira", loadout(7, [cell("joy", 4, "a", "b", "c", "d")]));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      withRuntime(
        <QueryClientProvider client={client}>
          <ActionManageDialog open onOpenChange={vi.fn()} target={target} />
        </QueryClientProvider>,
      ),
    );
  });
  // Wait for every Anima's Loadout.
  await vi.waitFor(() =>
    expect(
      container.querySelectorAll('[role="group"] button:not([disabled])'),
    ).toHaveLength(enabled),
  );
  const row = (anima: string) =>
    container.querySelector<HTMLElement>(
      `[role="group"][aria-label="${anima}"]`,
    )!;
  /** A row's button, found by its accessible name (Anima and cell). */
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(
      `[role="group"] button[aria-label="${label}"]`,
    )!;
  const selects = () =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-select]"));
  const choose = async (select: HTMLElement, value: string) =>
    act(async () =>
      select
        .querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)!
        .click(),
    );
  return { container, row, button, selects, choose };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  mocks.loadouts.clear();
  mocks.changeReaction.mockReset();
  mocks.pending.clear();
  for (const toast of Object.values(mocks.toast)) toast.mockReset();
});

describe("equipping a Reaction to a chosen cell", () => {
  it("starts on the Reaction's suggested cell and reports each Anima's pool there", async () => {
    const view = await render(cheer);
    const [emotion, intensity] = view.selects();
    expect(emotion!.dataset.select).toBe("joy");
    expect(intensity!.dataset.select).toBe("4");
    // The four intensity labels.
    expect(
      Array.from(intensity!.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Mild", "Moderate", "Strong", "Intense"]);

    // Each button names its Anima and cell.
    expect(view.row("Rowan").textContent).toContain("In this cell");
    expect(
      view.button("Remove from Rowan's Joy · Intense").textContent,
    ).toContain("Remove");
    expect(view.row("Luna").textContent).toContain("Not in this cell");
    const add = view.button("Add to Luna's Joy · Intense");
    expect(add.textContent).toContain("Add");
    expect(add.hasAttribute("disabled")).toBe(false);

    // A full cell disables Add and says why.
    const full = view.button("Add to Mira's Joy · Intense");
    expect(full.textContent).toContain("Add");
    expect(full.hasAttribute("disabled")).toBe(true);
    const reason = document.getElementById(
      full.getAttribute("aria-describedby")!,
    );
    expect(reason?.textContent).toContain("four Reactions");
  });

  it("uses Joy, Mild for a Reaction without a suggestion", async () => {
    // No Anima has Cheer in Joy · Mild, and no pool there is full.
    const view = await render(
      { ...cheer, emotion: undefined, intensity: undefined },
      3,
    );
    const [emotion, intensity] = view.selects();
    expect(emotion!.dataset.select).toBe("joy");
    expect(intensity!.dataset.select).toBe("1");
    expect(view.row("Rowan").textContent).toContain("Not in this cell");
  });

  it("follows the chosen cell", async () => {
    const view = await render(cheer);
    const [emotion, intensity] = view.selects();
    await view.choose(emotion!, "grief");
    await view.choose(intensity!, "2");
    expect(view.row("Rowan").textContent).toContain("In this cell");
    expect(view.row("Mira").textContent).toContain("Not in this cell");
    expect(view.button("Remove from Rowan's Grief · Moderate")).not.toBeNull();
    expect(
      view.button("Add to Mira's Grief · Moderate").hasAttribute("disabled"),
    ).toBe(false);
  });

  it("adds to the chosen cell's pool without touching its other members", async () => {
    mocks.changeReaction.mockResolvedValue({ revision: 6, warnings: [] });
    const view = await render(cheer);
    const [emotion, intensity] = view.selects();
    await view.choose(emotion!, "grief");
    await view.choose(intensity!, "3");
    await act(async () => view.button("Add to Luna's Grief · Strong").click());
    expect(mocks.changeReaction).toHaveBeenCalledTimes(1);
    expect(mocks.changeReaction).toHaveBeenCalledWith("luna", {
      expected_revision: 5,
      intent: {
        operation: "add",
        emotion: "grief",
        intensity: 3,
        source: {
          type: "catalog",
          catalog_item_id: "cheer",
          logical_key: "local:reaction:cheer",
          source: "local",
        },
      },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      expect.stringContaining("Luna"),
    );
  });

  it("removes only this Reaction's member of the chosen cell", async () => {
    mocks.changeReaction.mockResolvedValue({ revision: 4, warnings: [] });
    const view = await render(cheer);
    await act(async () =>
      view.button("Remove from Rowan's Joy · Intense").click(),
    );
    expect(mocks.changeReaction).toHaveBeenCalledWith("rowan", {
      expected_revision: 3,
      intent: { operation: "remove", binding_id: "cheer-binding" },
    });
  });

  it("asks for a retry when the Anima's Reactions changed elsewhere", async () => {
    mocks.changeReaction.mockRejectedValue(
      Object.assign(new Error("conflict"), {
        detail: { code: "loadout_revision_conflict" },
      }),
    );
    const view = await render(cheer);
    await act(async () => view.button("Add to Luna's Joy · Intense").click());
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "This Anima's Reactions changed elsewhere and have been refreshed. Try again.",
      expect.anything(),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("shows plan warnings as toasts", async () => {
    mocks.changeReaction.mockResolvedValue({
      revision: 6,
      warnings: [
        {
          code: "starter_reaction_unavailable",
          message:
            "Included Reaction joy-4 is unavailable and was not restored.",
          params: { contentId: "joy-4" },
        },
      ],
    });
    const view = await render(cheer);
    await act(async () => view.button("Add to Luna's Joy · Intense").click());
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      "A starter Reaction is unavailable and was not restored.",
    );
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
  });

  it("keeps an Anima's row waiting while its change applies, in any cell", async () => {
    mocks.pending.add("luna");
    // Only Rowan's Remove is ready: Luna is applying a change and Mira is full.
    const view = await render(cheer, 1);
    const waiting = view.button("Add to Luna's Joy · Intense");
    expect(waiting.hasAttribute("disabled")).toBe(true);
    expect(waiting.textContent).not.toContain("Add");

    const [emotion, intensity] = view.selects();
    await view.choose(emotion!, "grief");
    await view.choose(intensity!, "2");
    expect(
      view.button("Add to Luna's Grief · Moderate").hasAttribute("disabled"),
    ).toBe(true);
    expect(
      view.button("Add to Mira's Grief · Moderate").hasAttribute("disabled"),
    ).toBe(false);
    expect(mocks.changeReaction).not.toHaveBeenCalled();
  });
});
