import type {
  DndContextProps,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPose } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  ActionCatalogDragProvider,
  useCatalogTimelineDrop,
} from "./ActionCatalogDrag";
import type { CatalogDragItem } from "./timelineCatalogDrop";

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  callbacks: null as DndContextProps | null,
  addComponent: vi.fn(),
  mode: "clip",
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (setup: () => void | (() => void)) => harness.effects.push(setup),
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: (props: DndContextProps) => {
    harness.callbacks = props;
    return props.children;
  },
  DragOverlay: () => null,
  MouseSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}));
vi.mock("./ActionEditorWorkspaceContext", () => ({
  useActionEditorWorkspace: () => ({
    mode: harness.mode,
    document: { implementation: "anima_clip" },
    timelineSession: 1,
    addComponent: harness.addComponent,
  }),
}));

const rect = {
  left: 100,
  top: 200,
  width: 888,
  height: 176,
  right: 988,
  bottom: 376,
};
const savedPose: CatalogDragItem = {
  kind: "pose",
  pose: {
    id: "wave",
    name: "Wave",
    createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:00:00Z",
    source: {
      key: "preview",
      sourceType: "resolved_entry",
      displayName: "Preview",
      sourceLabel: "Preview Anima",
      versionLabel: "Current",
    },
    basePose: "relaxedRest",
    pose: parseAnimaPose({
      schema: "animaPose/1.0",
      id: "wave",
      name: "Wave",
      expressions: { happy: 0.5 },
    }),
  },
};
let cleanups: Array<void | (() => void)> = [];

function Target({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const element = { getBoundingClientRect: () => rect };
  useCatalogTimelineDrop(
    {
      track: { current: element as HTMLDivElement },
      section: { current: element as HTMLElement },
      expanded,
      onExpandedChange,
    },
    true,
  );
  return null;
}

/** Capture real coordinator callbacks and effect closures without a DOM/WebGL. */
function mount(expanded = true, onExpandedChange = vi.fn()) {
  renderToString(
    <ActionCatalogDragProvider>
      <Target expanded={expanded} onExpandedChange={onExpandedChange} />
    </ActionCatalogDragProvider>,
  );
  cleanups = harness.effects.map((setup) => setup());
  return onExpandedChange;
}
function start() {
  harness.callbacks?.onDragStart?.({
    active: {
      id: "wave",
      data: { current: { catalogItem: savedPose } },
      rect: { current: { initial: null, translated: null } },
    },
    activatorEvent: new MouseEvent("mousedown", { clientX: 0, clientY: 0 }),
  } satisfies DragStartEvent);
}
function movement(x: number, y = 250) {
  return { delta: { x, y } } as DragEndEvent;
}

beforeEach(() => {
  vi.useFakeTimers();
  harness.mode = "clip";
  harness.effects.length = 0;
  harness.callbacks = null;
  harness.addComponent.mockClear();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "MouseEvent",
    class extends Event {
      clientX: number;
      clientY: number;
      constructor(type: string, init: MouseEventInit) {
        super(type);
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
      }
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback, 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  usePoseCreatorStore.getState().resetWorkspace();
  usePoseCreatorStore.setState((state) => ({
    clipDraft: { ...state.clipDraft, duration: 1 },
  }));
  usePoseCreatorStore.getState().setClipSnapEnabled(true);
  usePoseCreatorStore.getState().setClipSnapInterval(0.1);
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup?.());
  cleanups = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("catalog drag coordinator", () => {
  it("keeps hovering transient and commits one snapped pose edit only on release", () => {
    mount();
    const before = usePoseCreatorStore.getState();
    start();
    harness.callbacks?.onDragMove?.(movement(438));
    vi.advanceTimersByTime(16);
    expect(usePoseCreatorStore.getState()).toBe(before);
    expect(harness.addComponent).not.toHaveBeenCalled();

    harness.callbacks?.onDragEnd?.(movement(438));
    const after = usePoseCreatorStore.getState();
    expect(after.clipDraft.keyframes).toEqual([
      expect.objectContaining({ time: 0.3, pose: "wave" }),
    ]);
    expect(after.clipDraft.currentTimeSec).toBe(0.3);
    expect(after.clipUndoHistory).toHaveLength(1);
    // A repeated end notification cannot author the same drop twice.
    harness.callbacks?.onDragEnd?.(movement(438));
    expect(usePoseCreatorStore.getState()).toBe(after);
  });

  it.each(["outside", "escape", "blur"])(
    "cancels %s without editing the document or playhead",
    (reason) => {
      mount();
      const before = usePoseCreatorStore.getState();
      start();
      harness.callbacks?.onDragMove?.(movement(438));
      vi.advanceTimersByTime(16);
      if (reason === "outside") {
        harness.callbacks?.onDragEnd?.(movement(10));
      } else if (reason === "escape") {
        harness.callbacks?.onDragCancel?.({} as DragEndEvent);
      } else {
        window.dispatchEvent(new Event("blur"));
        harness.callbacks?.onDragEnd?.(movement(438));
      }
      vi.runAllTimers();
      expect(usePoseCreatorStore.getState()).toBe(before);
      expect(harness.addComponent).not.toHaveBeenCalled();
    },
  );

  it("expands after 300ms of collapsed hover and restores collapse on cancellation", () => {
    const onExpandedChange = mount(false);
    const before = usePoseCreatorStore.getState();
    start();
    harness.callbacks?.onDragMove?.(movement(438));
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(299);
    expect(onExpandedChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpandedChange.mock.calls).toEqual([[true]]);
    harness.callbacks?.onDragCancel?.({} as DragEndEvent);
    expect(onExpandedChange.mock.calls).toEqual([[true], [false]]);
    expect(usePoseCreatorStore.getState()).toBe(before);
  });

  it("cancels pending expansion when the pointer leaves the collapsed timeline", () => {
    const onExpandedChange = mount(false);
    start();
    harness.callbacks?.onDragMove?.(movement(438));
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(200);
    harness.callbacks?.onDragMove?.(movement(10));
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(300);
    expect(onExpandedChange).not.toHaveBeenCalled();
  });
});

it("enables effect drops in Reaction mode", () => {
  harness.mode = "reaction";
  harness.addComponent.mockReturnValue("inserted-effect");
  mount();
  harness.callbacks?.onDragStart?.({
    active: {
      id: "hearts",
      data: {
        current: {
          catalogItem: {
            kind: "effect",
            contentType: "particle_effect",
            item: {
              item_id: "hearts",
              name: "Hearts",
              source: { type: "builtin", content_id: "hearts", version: 1 },
            },
          },
        },
      },
      rect: { current: { initial: null, translated: null } },
    },
    activatorEvent: new MouseEvent("mousedown", { clientX: 0, clientY: 0 }),
  });
  harness.callbacks?.onDragEnd?.(movement(438));
  expect(harness.addComponent).toHaveBeenCalledOnce();
  expect(harness.addComponent).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Hearts" }),
    "particle_effect",
    { timeSec: 0.3 },
  );
});
