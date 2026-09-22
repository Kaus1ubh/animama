import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  ActionEditorWorkspace,
  captureActionEditorPoseAtPlayhead,
} from "./ActionEditorWorkspace";
import { createActionDocument } from "./actionDocument";

vi.mock("@/query/hooks/usePoses", () => ({
  usePoses: () => ({
    data: { items: [] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const harness = vi.hoisted(() => ({
  mode: "pose",
  document: null as ReturnType<typeof createActionDocument> | null,
  subscriptions: [] as Array<(onChange: () => void) => () => void>,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  // Exercise client snapshots in SSR without a DOM/WebGL implementation.
  useSyncExternalStore: (
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => unknown,
  ) => {
    harness.subscriptions.push(subscribe);
    return getSnapshot();
  },
}));
vi.mock("./ActionCatalogDrag", () => ({
  ActionCatalogDragProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
vi.mock("./ActionEditorWorkspaceContext", () => ({
  useActionEditorWorkspace: () => ({
    document: harness.document,
    mode: harness.mode,
    busy: false,
    history: { canUndo: false, canRedo: false },
    dependencySections: [],
  }),
}));
vi.mock("./ActionEditorPreviewProvider", () => ({
  useActionEditorPreview: () => ({}),
}));
vi.mock("./ActionEditorScene", () => ({
  ActionEditorScene: () => <div data-scene />,
}));
vi.mock("./ActionEditorHeader", () => ({ ActionEditorHeader: () => null }));
vi.mock("./ActionEditorEffectsPanel", () => ({
  ActionEditorEffectsPanel: () => null,
}));
vi.mock("./ActionTimelineEditor", () => ({
  ActionTimelineDocumentSync: () => null,
  ActionTimelineEditor: () => <div data-timeline />,
}));
vi.mock("./ActionEditorPrimitives", () => ({
  ActionEditorBoneSection: ({ variant }: { variant: string }) => (
    <div data-bones={variant} />
  ),
  ActionEditorClipInspector: () => null,
  ActionEditorClipPreviewSync: () => null,
  ActionEditorExpressionSection: () => <div data-expressions />,
  ActionEditorPreviewSettings: () => null,
}));
vi.mock("@/ui/avatar-preview/PlaybackObservationOutput", () => ({
  PlaybackObservationOutput: () => null,
}));
vi.mock("@/ui/creator-history/CreatorHistory", () => ({
  CreatorHistoryShortcut: () => null,
}));

let media: EventTarget & { matches: boolean };
beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  harness.mode = "pose";
  harness.document = createActionDocument("gesture");
  harness.subscriptions = [];
  media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal("window", { matchMedia: vi.fn(() => media) });
});
afterEach(() => vi.unstubAllGlobals());

describe("Action editor viewport ownership", () => {
  it.each([true, false])(
    "mounts one scene and one pose toolset when desktop is %s",
    (desktop) => {
      media.matches = desktop;
      const html = renderToString(<ActionEditorWorkspace />);
      expect(html.match(/data-scene=/g)).toHaveLength(1);
      expect(html.match(/data-bones=/g)).toHaveLength(1);
      expect(html).toContain(
        `data-bones="${desktop ? "workspace" : "mobile"}"`,
      );
      expect(html.includes('aria-label="Authoring tools"')).toBe(!desktop);
    },
  );

  it.each([
    ["gesture", "clip", true],
    ["gesture", "clip", false],
    ["reaction", "reaction", true],
    ["reaction", "reaction", false],
  ] as const)(
    "mounts one %s timeline in %s mode (desktop=%s)",
    (intent, mode, desktop) => {
      harness.document = createActionDocument(intent);
      harness.mode = mode;
      media.matches = desktop;
      const html = renderToString(<ActionEditorWorkspace />);
      expect(html.match(/data-scene=/g)).toHaveLength(1);
      expect(html.match(/data-timeline=/g)).toHaveLength(1);
      expect(html).not.toContain("data-bones=");
    },
  );

  it("switches layout on the lg media change without changing the authored draft", () => {
    usePoseCreatorStore.getState().setBoneDraft("leftUpperArm", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 35, y: 0, z: 0 },
    });
    const before = usePoseCreatorStore.getState();
    renderToString(<ActionEditorWorkspace />);
    const onChange = vi.fn();
    const cleanups = harness.subscriptions.map((subscribe) =>
      subscribe(onChange),
    );
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledOnce();
    const html = renderToString(<ActionEditorWorkspace />);
    expect(html.match(/data-scene=/g)).toHaveLength(1);
    expect(html).toContain('data-bones="mobile"');
    expect(usePoseCreatorStore.getState()).toBe(before);
    cleanups.forEach((cleanup) => cleanup());
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(window.matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
  });
});

it("captures the current copied pose when a baked timeline has no external base", () => {
  usePoseCreatorStore.setState((state) => ({
    clipDraft: {
      ...state.clipDraft,
      basePose: "",
      currentTimeSec: 0.5,
      poses: {
        start: {
          humanoid: { hips: { position: [0, 0.4, 0] } },
          expressions: { happy: 0.6 },
        },
      },
      keyframes: [{ id: "start", pose: "start", time: 0 }],
      selectedKeyframeId: null,
    },
  }));
  expect(captureActionEditorPoseAtPlayhead()).toBe(true);
  const { clipDraft, clipUndoHistory } = usePoseCreatorStore.getState();
  const added = clipDraft.keyframes.find((frame) => frame.time === 0.5)!;
  expect(clipDraft.poses[added.pose]).toMatchObject({
    humanoid: { hips: { position: [0, 0.4, 0] } },
    expressions: { happy: 0.6 },
  });
  expect(clipDraft.basePose).toBe("");
  expect(clipUndoHistory).toHaveLength(1);
});
