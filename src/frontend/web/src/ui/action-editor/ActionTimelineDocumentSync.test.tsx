import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPose, parseAnimaPoseClip } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  actionAuthoringSnapshot,
  actionAuthoringSnapshotsEqual,
  applyActionAuthoringSnapshot,
  createActionDocument,
} from "./actionDocument";
import {
  actionSequenceFromTimelineDraft,
  canonicalizeActionComponentInsertion,
} from "./actionPersistence";
import { addActionComponentEvent } from "./actionDependencies";
import {
  commitCreatorHistory,
  createCreatorHistoryState,
  redoCreatorHistory,
  undoCreatorHistory,
} from "@/ui/creator-history/CreatorHistory";
import { ActionTimelineDocumentSync } from "./ActionTimelineEditor";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);

const refHarness = vi.hoisted(() => ({
  enabled: false,
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    // SSR normally remounts refs. Preserve them only for the explicit multi-render
    // synchronization test so it exercises the same mounted effect state.
    useRef: <T,>(initial: T) => {
      if (!refHarness.enabled) return actual.useRef(initial);
      const index = refHarness.cursor++;
      refHarness.refs[index] ??= { current: initial };
      return refHarness.refs[index] as { current: T };
    },
  };
});

// Read the live client store while collecting the component's actual effect
// closures with SSR; no DOM or WebGL is needed to exercise the replay boundary.
vi.mock("@/stores/pose-creator-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.usePoseCreatorStore.getState>,
        ) => unknown,
      ) => selector(actual.usePoseCreatorStore.getState()),
      actual.usePoseCreatorStore,
    ),
  };
});

beforeEach(() => {
  effects.length = 0;
  refHarness.enabled = false;
  refHarness.refs = [];
  refHarness.cursor = 0;
  usePoseCreatorStore.getState().resetWorkspace();
});

describe("ActionTimelineDocumentSync route handoff", () => {
  it.each(["gesture", "reaction"] as const)(
    "does not emit the previous creator's expression into a new %s on StrictMode effect replay",
    (intent) => {
      usePoseCreatorStore.getState().hydrateClipDocument(
        parseAnimaPoseClip({
          schema: "animaPoseClip/1.0",
          id: "previous-reaction",
          name: "Previous Reaction",
          duration: 1,
          poses: { expression: { expressions: { happy: 1 } } },
          poseKeyframes: [{ time: 0, pose: "expression" }],
        }),
      );
      const onChange = vi.fn();
      renderToString(
        <ActionTimelineDocumentSync
          sequence={{
            ...createActionDocument(intent).sequence,
            poses: {},
            poseKeyframes: [],
          }}
          session={0}
          reaction={intent === "reaction"}
          onChange={onChange}
        />,
      );

      // StrictMode replays setup with the same render closures, even though the
      // first hydration has already replaced the retained Zustand timeline.
      const cleanups = effects.map((setup) => setup());
      cleanups.forEach((cleanup) => cleanup?.());
      effects.forEach((setup) => setup());

      expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual([]);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});

describe("ActionTimelineDocumentSync history roundtrip", () => {
  it("rehydrates a previously emitted pose sequence on Redo instead of overwriting it", () => {
    const store = usePoseCreatorStore.getState();
    store.hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "new-gesture",
        name: "New Gesture",
        duration: 1.2,
        poses: { initial: { expressions: { happy: 0.1 } } },
        poseKeyframes: [{ time: 0, pose: "initial" }],
      }),
    );
    let document = createActionDocument("gesture");
    document.sequence = actionSequenceFromTimelineDraft(
      usePoseCreatorStore.getState().clipDraft,
      "gesture",
    )!;
    const baseline = actionAuthoringSnapshot(document);
    let history = createCreatorHistoryState(baseline);
    const onChange = vi.fn((sequence: Record<string, unknown>) => {
      history = commitCreatorHistory(
        history,
        { ...history.present, sequence },
        actionAuthoringSnapshotsEqual,
      );
      document = applyActionAuthoringSnapshot(document, history.present);
    });
    refHarness.enabled = true;
    const renderSync = () => {
      effects.length = 0;
      refHarness.cursor = 0;
      renderToString(
        <ActionTimelineDocumentSync
          sequence={document.sequence}
          session={1}
          reaction={false}
          onChange={onChange}
        />,
      );
      effects.forEach((setup) => setup());
    };
    renderSync();
    renderSync();
    expect(onChange).not.toHaveBeenCalled();

    store.addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "dropped",
        name: "Dropped",
        expressions: { happy: 1 },
      }),
      "dropped",
      { timeSec: 0.6 },
    );
    renderSync();
    renderSync();
    const authored = actionAuthoringSnapshot(document);
    expect(authored.sequence.poseKeyframes).toHaveLength(2);
    expect(history.past).toHaveLength(1);

    history = undoCreatorHistory(history);
    document = applyActionAuthoringSnapshot(document, history.present);
    renderSync();
    renderSync();
    expect(
      actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        "gesture",
      ),
    ).toEqual(baseline.sequence);
    expect(history.future).toHaveLength(1);

    history = redoCreatorHistory(history);
    document = applyActionAuthoringSnapshot(document, history.present);
    renderSync();
    renderSync();
    expect(
      actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        "gesture",
      ),
    ).toEqual(authored.sequence);
    expect(actionAuthoringSnapshot(document)).toEqual(authored);
    expect(history.past).toHaveLength(1);
    expect(history.future).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Effects enter through document history, then hydrate the shared store.
    // Switching selection must not leave a stale event behind after Undo.
    const effectDocument = canonicalizeActionComponentInsertion(
      addActionComponentEvent(document, {
        name: "Sparkles",
        contentType: "particle_effect",
        source: { type: "builtin", content_id: "sparkles", version: 1 },
        time: 0.6,
      }),
    );
    history = commitCreatorHistory(
      history,
      actionAuthoringSnapshot(effectDocument),
      actionAuthoringSnapshotsEqual,
    );
    document = applyActionAuthoringSnapshot(document, history.present);
    renderSync();
    renderSync();
    const effectDraft = usePoseCreatorStore.getState().clipDraft;
    store.selectClipEvent(effectDraft.events[0]!.id);
    store.selectClipKeyframe(effectDraft.keyframes[0]!.id);
    renderSync();
    expect(history.past).toHaveLength(2);

    history = undoCreatorHistory(history);
    document = applyActionAuthoringSnapshot(document, history.present);
    renderSync();
    renderSync();
    expect(
      actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        "gesture",
      ),
    ).toEqual(authored.sequence);
    expect(document.dependencies).toEqual([]);
    expect(history.future).toHaveLength(1);

    history = redoCreatorHistory(history);
    document = applyActionAuthoringSnapshot(document, history.present);
    renderSync();
    renderSync();
    expect(
      actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        "gesture",
      ),
    ).toEqual(effectDocument.sequence);
    expect(document.dependencies).toEqual(effectDocument.dependencies);
    expect(history.past).toHaveLength(2);
    expect(history.future).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
