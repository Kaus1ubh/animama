import { describe, expect, it } from "vitest";

import { DEFAULT_POSE_CREATOR_BASE_POSE } from "@/stores/pose-creator-store";
import { createDefaultPoseCreatorClipDraft } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { createActionDocument } from "./actionDocument";
import { actionDocumentForPersistence } from "./actionPersistence";

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
