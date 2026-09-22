import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import { createDefaultPoseCreatorClipDraft } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { parseAnimaPose } from "@/lib/avatar/poses/animaPose";
import {
  parseAnimaPoseClip,
  sampleAnimaPoseClip,
} from "@/lib/avatar/poses/animaPoseClip";
import { createActionProject, parseActionImport } from "./actionProject";
import { createActionDocument } from "./actionDocument";
import {
  actionDocumentForPersistence,
  canonicalizeActionComponentInsertion,
} from "./actionPersistence";

describe("actionDocumentForPersistence", () => {
  it("captures the live timeline and removes declarations unused by that snapshot", () => {
    const document = createActionDocument("reaction");
    document.dependencies = [
      {
        alias: "comic_pop",
        content_type: "scene_effect",
        source: {
          type: "builtin",
          content_id: "builtin:scene-effect:comic-pop",
          version: 1,
        },
      },
      {
        alias: "old_hearts",
        content_type: "particle_effect",
        source: {
          type: "builtin",
          content_id: "builtin:particle-effect:hearts",
          version: 1,
        },
      },
    ];
    document.sequence = {
      ...document.sequence,
      events: [
        {
          id: "comic-pop",
          time: 0.55,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "comic_pop",
        },
      ],
    };
    const draft = createDefaultPoseCreatorClipDraft(
      DEFAULT_POSE_CREATOR_BASE_POSE,
    );
    document.name = "React Happy → Angry";
    draft.id = "pose_creator_clip";
    draft.name = "New Reaction";
    draft.events = [
      {
        id: "comic-pop",
        time: 0.7,
        kind: "scene_vfx",
        sceneKind: "background_layers",
        presetId: "comic_pop",
      },
    ];

    const persisted = actionDocumentForPersistence(document, draft);

    expect(persisted.sequence.events).toEqual([
      expect.objectContaining({ id: "comic-pop", time: 0.7 }),
    ]);
    expect(persisted.dependencies.map((value) => value.alias)).toEqual([
      "comic_pop",
    ]);
    expect(persisted.sequence.id).toBe("react-happy-angry");
    expect(persisted.sequence.name).toBe("React Happy → Angry");
  });
});

describe("copied pose persistence", () => {
  it("preserves a standalone snapshot through Save, component synchronization and project round-trip", () => {
    const store = usePoseCreatorStore.getState();
    store.resetWorkspace();
    store.addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "original",
        name: "Original",
        parent: { ref: "relaxedRest" },
        expressions: { happy: 0.6 },
      }),
      "Original",
      { atPlayhead: true },
    );
    const document = createActionDocument("gesture");
    document.name = "Copied Action";
    document.semanticKey = "copied-action";
    const persisted = actionDocumentForPersistence(
      document,
      usePoseCreatorStore.getState().clipDraft,
    );
    const canonical = canonicalizeActionComponentInsertion(persisted);
    expect(persisted.sequence.basePose).toBeUndefined();
    expect(canonical.sequence.basePose).toBeUndefined();
    expect(canonical.dependencies).toEqual([]);
    const expected = sampleAnimaPoseClip(
      parseAnimaPoseClip(canonical.sequence),
      0.5,
    );
    for (const serialized of [
      JSON.stringify(canonical.sequence),
      JSON.stringify(createActionProject(canonical)),
    ]) {
      const imported = parseActionImport(JSON.parse(serialized), "gesture");
      const clip =
        imported.kind === "clip"
          ? imported.sequence
          : imported.project.sequence;
      expect(clip.basePose).toBeUndefined();
      expect(sampleAnimaPoseClip(clip, 0.5, () => null)).toEqual(expected);
      expect(store.hydrateClipDocument(clip)).toBe(true);
      expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe("");
    }
    store.resetWorkspace();
  });
});
