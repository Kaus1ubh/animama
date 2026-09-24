import { describe, expect, it } from "vitest";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import {
  actionSequenceFromTimelineDraft,
  canonicalizeActionComponentInsertion,
} from "./actionPersistence";
import {
  addActionComponentEvent,
  addActionDependency,
  mapActionDependency,
  pruneUnusedDependencies,
  pruneUnusedTimelineDependencies,
  removeActionDependency,
} from "./actionDependencies";
import {
  actionAuthoringSnapshot,
  actionAuthoringSnapshotsEqual,
  createActionDocument,
} from "./actionDocument";
import {
  commitCreatorHistory,
  createCreatorHistoryState,
  undoCreatorHistory,
} from "@/ui/creator-history/CreatorHistory";

describe("actionDependencies", () => {
  it("adds an exact component and playhead event as one document value", () => {
    const document = addActionComponentEvent(createActionDocument("reaction"), {
      name: "Sparkles",
      contentType: "particle_effect",
      source: {
        type: "catalog",
        catalog_item_id: "particle-1",
        logical_key: "local:particle-effect:sparkles",
      },
      time: 0.4,
    });
    expect(document.dependencies[0]).toMatchObject({
      alias: "sparkles",
      source: {
        type: "catalog",
        catalog_item_id: "particle-1",
        logical_key: "local:particle-effect:sparkles",
      },
    });
    expect(document.sequence.events).toEqual([
      expect.objectContaining({
        kind: "particle_vfx",
        effectId: "sparkles",
        time: 0.4,
      }),
    ]);
  });

  it("keeps same-time effects independent and undoes their dependencies with each insertion", () => {
    const document = createActionDocument("gesture");
    const input = {
      name: "Sparkles",
      contentType: "particle_effect" as const,
      source: { type: "builtin" as const, content_id: "sparkles", version: 1 },
      time: 0.37,
    };
    const first = addActionComponentEvent(document, input);
    const second = addActionComponentEvent(first, input);
    expect(second.sequence.duration).toBe(document.sequence.duration);
    expect(second.sequence.events).toEqual([
      expect.objectContaining({ time: 0.37, effectId: "sparkles" }),
      expect.objectContaining({ time: 0.37, effectId: "sparkles_2" }),
    ]);
    const events = second.sequence.events as { id: string }[];
    expect(events[0]?.id).not.toBe(events[1]?.id);

    let history = createCreatorHistoryState(actionAuthoringSnapshot(document));
    history = commitCreatorHistory(
      history,
      actionAuthoringSnapshot(first),
      actionAuthoringSnapshotsEqual,
    );
    history = commitCreatorHistory(
      history,
      actionAuthoringSnapshot(second),
      actionAuthoringSnapshotsEqual,
    );
    expect(history.past).toHaveLength(2);
    history = undoCreatorHistory(history);
    expect(history.present).toEqual(actionAuthoringSnapshot(first));
    history = undoCreatorHistory(history);
    expect(history.present).toEqual(actionAuthoringSnapshot(document));
  });

  it.each(["gesture", "reaction"] as const)(
    "undoes a %s effect and its dependency once after actual timeline hydration",
    (intent) => {
      usePoseCreatorStore.getState().resetWorkspace();
      const initial = createActionDocument(intent);
      const inserted = canonicalizeActionComponentInsertion(
        addActionComponentEvent(initial, {
          name: "Sparkles",
          contentType: "particle_effect",
          source: { type: "builtin", content_id: "sparkles", version: 1 },
          time: 0.6,
        }),
      );
      let history = commitCreatorHistory(
        createCreatorHistoryState(actionAuthoringSnapshot(initial)),
        actionAuthoringSnapshot(inserted),
        actionAuthoringSnapshotsEqual,
      );
      usePoseCreatorStore
        .getState()
        .hydrateClipDocument(parseAnimaPoseClip(inserted.sequence), {
          fallbackBasePose: DEFAULT_POSE_CREATOR_BASE_POSE,
        });
      const sequence = actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        intent,
      );
      // Document sync compares serialized values. Hydration must not manufacture
      // another edit that Undo restores and immediately commits again.
      expect(JSON.stringify(sequence)).toBe(JSON.stringify(inserted.sequence));
      history = commitCreatorHistory(
        history,
        actionAuthoringSnapshot({ ...inserted, sequence: sequence! }),
        actionAuthoringSnapshotsEqual,
      );
      expect(history.past).toHaveLength(1);
      history = undoCreatorHistory(history);
      expect(history.present).toEqual(actionAuthoringSnapshot(initial));
      expect(history.present.dependencies).toEqual([]);
      expect(history.present.sequence.events).toEqual([]);
    },
  );

  it("canonicalizes earlier effect insertions without replacing existing event IDs", () => {
    const later = addActionComponentEvent(createActionDocument("reaction"), {
      name: "Later",
      contentType: "sound_effect",
      source: { type: "builtin", content_id: "bell", version: 1 },
      time: 0.9,
    });
    const inserted = addActionComponentEvent(later, {
      name: "Earlier",
      contentType: "sound_effect",
      source: { type: "builtin", content_id: "bell", version: 1 },
      time: 0.3,
    });
    const canonical = canonicalizeActionComponentInsertion(inserted);
    const events = inserted.sequence.events as { id: string; time: number }[];
    expect(canonical.sequence.events).toEqual([events[1], events[0]]);
    expect(canonical.dependencies).toEqual(inserted.dependencies);
  });

  it("retains invalid imported sequence data while adding a component for repair", () => {
    const initial = createActionDocument("gesture");
    initial.sequence.poseKeyframes = [{ time: 0, pose: "missing" }];
    const next = addActionComponentEvent(initial, {
      name: "Sparkles",
      contentType: "particle_effect",
      source: { type: "builtin", content_id: "sparkles", version: 1 },
      time: 0.6,
    });
    expect(canonicalizeActionComponentInsertion(next)).toBe(next);
    expect(next.sequence.poseKeyframes).toEqual(initial.sequence.poseKeyframes);
    expect(next.sequence.events).toHaveLength(1);
    expect(next.dependencies).toHaveLength(1);
  });

  it("extends the clip when a visual effect is added at its endpoint", () => {
    const document = createActionDocument("gesture");
    const duration = Number(document.sequence.duration);

    const next = addActionComponentEvent(document, {
      name: "Sparkles",
      contentType: "particle_effect",
      source: { type: "builtin", content_id: "sparkles", version: 1 },
      time: duration,
    });

    expect(next.sequence.duration).toBe(duration + 1);
    expect(
      (next.sequence.events as Record<string, unknown>[])[0],
    ).not.toHaveProperty("duration");
    expect(next.sequence.events).toEqual([
      expect.objectContaining({
        time: duration,
        kind: "particle_vfx",
      }),
    ]);
  });

  it("authors built-in Scene VFX into their actual runtime lane", () => {
    const background = addActionComponentEvent(
      createActionDocument("reaction"),
      {
        name: "Comic Pop",
        contentType: "scene_effect",
        source: {
          type: "builtin",
          content_id: "builtin:scene-effect:comic-pop",
          version: 1,
        },
      },
    );
    const focus = addActionComponentEvent(createActionDocument("reaction"), {
      name: "Dark",
      contentType: "scene_effect",
      source: {
        type: "builtin",
        content_id: "builtin:scene-effect:dark",
        version: 1,
      },
    });

    expect(background.sequence.events).toEqual([
      expect.objectContaining({
        kind: "scene_vfx",
        sceneKind: "background_layers",
      }),
    ]);
    expect(focus.sequence.events).toEqual([
      expect.objectContaining({
        kind: "scene_vfx",
        sceneKind: "focus_lines",
      }),
    ]);
  });

  it("captures exact sources and prunes them with their final use", () => {
    let document = addActionDependency(createActionDocument("gesture"), {
      name: "Sparkles",
      contentType: "particle_effect",
      source: {
        type: "catalog",
        catalog_item_id: "particle-1",
        logical_key: "local:particle-effect:sparkles",
      },
    });
    document = {
      ...document,
      sequence: {
        ...document.sequence,
        events: [
          { id: "e1", time: 0, kind: "particle_vfx", effectId: "sparkles" },
        ],
      },
    };
    expect(pruneUnusedDependencies(document).dependencies).toHaveLength(1);
    expect(
      removeActionDependency(document, "sparkles").sequence.events,
    ).toEqual([]);
  });

  it("prunes stale dependencies as timeline events are deleted", () => {
    let document = addActionComponentEvent(createActionDocument("reaction"), {
      name: "Sparkles",
      contentType: "particle_effect",
      source: { type: "builtin", content_id: "sparkles", version: 1 },
    });
    document = addActionComponentEvent(document, {
      name: "Chime",
      contentType: "sound_effect",
      source: { type: "builtin", content_id: "chime", version: 1 },
    });

    const afterFirstDeletion = pruneUnusedTimelineDependencies({
      sequence: {
        ...document.sequence,
        events: (document.sequence.events as Record<string, unknown>[]).filter(
          (event) => event.effectId !== "sparkles",
        ),
      },
      dependencies: document.dependencies,
    });
    expect(afterFirstDeletion.dependencies.map((value) => value.alias)).toEqual(
      ["chime"],
    );

    const afterFinalDeletion = pruneUnusedTimelineDependencies({
      ...afterFirstDeletion,
      sequence: { ...afterFirstDeletion.sequence, events: [] },
    });
    expect(afterFinalDeletion.dependencies).toEqual([]);
  });

  it("maps an imported alias without duplicating its timeline event", () => {
    const document = createActionDocument("gesture");
    document.sequence.events = [
      {
        id: "sparkles-1",
        time: 0,
        kind: "particle_vfx",
        effectId: "sparkles",
      },
    ];
    const mapped = mapActionDependency(document, {
      alias: "sparkles",
      contentType: "particle_effect",
      source: { type: "builtin", content_id: "sparkles", version: 1 },
    });
    expect(mapped.dependencies).toHaveLength(1);
    expect(mapped.sequence.events).toHaveLength(1);
  });
});
