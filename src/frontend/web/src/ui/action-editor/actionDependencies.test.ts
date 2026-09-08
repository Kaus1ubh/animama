import { describe, expect, it } from "vitest";
import {
  addActionComponentEvent,
  addActionDependency,
  mapActionDependency,
  pruneUnusedDependencies,
  pruneUnusedTimelineDependencies,
  removeActionDependency,
} from "./actionDependencies";
import { createActionDocument } from "./actionDocument";

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
    expect(next.sequence.events).toEqual([
      expect.objectContaining({
        time: duration,
        kind: "particle_vfx",
        duration: 1,
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
