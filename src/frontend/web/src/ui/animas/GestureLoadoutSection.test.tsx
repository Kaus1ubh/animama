// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PyAnimaLoadout,
  PyGestureBinding,
} from "@animama/runtime-contracts/api-types";
import type { PyGesture } from "@/lib/content/catalogTypes";
import { presentGestureCatalog } from "@/lib/loadout/animaLoadoutPresentation";
import { TooltipProvider } from "@/ui/components/tooltip";
import { GestureLoadoutSection } from "./GestureLoadoutSection";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function gesture(
  id: string,
  source: "included" | "local" = "included",
): PyGesture {
  return {
    item_id: id,
    name: id,
    description: null,
    origin: source === "included" ? "builtin" : "owned",
    state: "ready",
    created_at: null,
    updated_at: null,
    semantic_key: id,
    implementation_kind: "vrma",
    source: {
      type: "catalog",
      catalog_item_id: id,
      source,
      logical_key: `${source === "included" ? "builtin" : "local"}:gesture:${id}`,
    },
  };
}

const gestures = [
  gesture("Bow"),
  gesture("Wave"),
  gesture("Idle"),
  gesture("Beckon"),
  gesture("Local", "local"),
];
const binding = (id: string): PyGestureBinding => ({
  binding_id: `binding-${id}`,
  name: id,
  semantic_key: id,
  implementation_kind: "vrma",
  source: {
    type: "catalog",
    catalog_item_id: id,
    source: "included",
    logical_key: `builtin:gesture:${id}`,
  },
});
const loadout: PyAnimaLoadout = {
  anima_id: "anima-1",
  aggregate_revision: 1,
  revision: 1,
  starter_version: 1,
  gestures: [binding("Wave"), binding("Idle")],
  reactions: [],
  idle: { default_pool: [], cells: [] },
};

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(items = gestures, currentLoadout = loadout) {
  const callbacks = {
    onEquip: vi.fn(),
    onRemove: vi.fn(),
    onPreview: vi.fn(),
    onPreviewAvailable: vi.fn(),
    onRetryCatalog: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <TooltipProvider>
        <GestureLoadoutSection
          catalog={presentGestureCatalog(items, currentLoadout.gestures)}
          catalogLoading={false}
          catalogError={false}
          mutationsDisabled={false}
          {...callbacks}
        />
      </TooltipProvider>,
    ),
  );
  act(() =>
    container!
      .querySelector<HTMLButtonElement>(
        '[aria-controls="gesture-loadout-content"]',
      )!
      .click(),
  );
  return { view: container, callbacks };
}

const rowFor = (view: HTMLElement, name: string) =>
  [...view.querySelectorAll<HTMLElement>('[role="listitem"]')].find(
    (row) => row.querySelector("p")?.textContent === name,
  )!;
const rowNames = (view: HTMLElement) =>
  [...view.querySelectorAll('[role="listitem"] p:first-child')].map(
    (row) => row.textContent,
  );

function openFilters(view: HTMLElement) {
  act(() =>
    view
      .querySelector('[aria-label="Filter and sort Gestures"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
}
function toggleSource(label: string) {
  const checkbox = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
  ].find((item) => item.textContent?.includes(label));
  expect(checkbox).toBeDefined();
  act(() => checkbox!.click());
}

describe("Gesture Loadout catalog", () => {
  it("shows all sources by default and keeps totals to the left of independently selectable filters", () => {
    const { view } = mount();
    expect(rowNames(view).sort()).toEqual([
      "Beckon",
      "Bow",
      "Idle",
      "Local",
      "Wave",
    ]);
    expect(view.textContent).toContain("2 equipped / 5 total");
    const filter = view.querySelector(
      '[aria-label="Filter and sort Gestures"]',
    )!;
    expect(filter.previousElementSibling?.textContent).toBe(
      "2 equipped / 5 total",
    );

    openFilters(view);
    const included = [
      ...document.querySelectorAll('[role="menuitemcheckbox"]'),
    ].find((item) => item.textContent?.includes("Show included"));
    const local = [
      ...document.querySelectorAll('[role="menuitemcheckbox"]'),
    ].find((item) => item.textContent?.includes("Show local"));
    expect(included?.getAttribute("aria-checked")).toBe("true");
    expect(local?.getAttribute("aria-checked")).toBe("true");
    toggleSource("Show included");
    expect(rowNames(view)).toEqual(["Local"]);
    expect(view.textContent).toContain("2 equipped / 5 total");
    toggleSource("Show local");
    expect(rowNames(view)).toEqual([]);
    expect(view.textContent).toContain(
      "No Gestures match the selected filters.",
    );
    toggleSource("Show included");
    expect(rowNames(view).sort()).toEqual(["Beckon", "Bow", "Idle", "Wave"]);
    expect(view.textContent).toContain("2 equipped / 5 total");
  });

  it("equips with add and unequips with remove, with no starter-specific state", () => {
    const { view, callbacks } = mount();
    for (const name of ["Bow", "Wave", "Idle", "Beckon"])
      act(() =>
        rowFor(view, name).querySelector<HTMLButtonElement>("button")!.click(),
      );
    expect(callbacks.onEquip.mock.calls).toEqual([
      [gestures[0]],
      [gestures[3]],
    ]);
    expect(callbacks.onRemove.mock.calls).toEqual([
      [loadout.gestures[0]],
      [loadout.gestures[1]],
    ]);
    // Every row has the Library and Remove menu; none carries a Starter badge.
    expect(
      view.querySelectorAll('[aria-label^="More actions for"]'),
    ).toHaveLength(5);
    expect(view.querySelector('[aria-label="Starter"]')).toBeNull();
  });

  it("equips a removed Included Gesture again with an ordinary add", () => {
    const airQuotes: PyGesture = {
      ...gesture("Air Quotes"),
      semantic_key: "air_quotes",
      source: {
        type: "catalog",
        catalog_item_id: "air-quotes",
        source: "included",
        logical_key: "builtin:gesture:air-quotes",
      },
    };
    const { view, callbacks } = mount([airQuotes], {
      ...loadout,
      gestures: [],
    });
    expect(rowNames(view)).toEqual(["Air Quotes"]);
    act(() =>
      rowFor(view, "Air Quotes")
        .querySelector<HTMLButtonElement>("button")!
        .click(),
    );
    expect(callbacks.onEquip).toHaveBeenCalledExactlyOnceWith(airQuotes);
  });

  it("counts the full catalog before Show more and search", () => {
    const { view } = mount([
      ...gestures,
      ...Array.from({ length: 20 }, (_, index) =>
        gesture(`Extra ${index}`, "local"),
      ),
    ]);
    expect(view.textContent).toContain("2 equipped / 25 total");
    expect(rowNames(view)).toHaveLength(20);
    const more = [...view.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Show more",
    )!;
    act(() => more.click());
    expect(rowNames(view)).toHaveLength(25);
    const search = view.querySelector<HTMLInputElement>(
      '[aria-label="Search gestures"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "Beckon");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rowNames(view)).toEqual(["Beckon"]);
    expect(view.textContent).toContain("2 equipped / 25 total");
  });
});
