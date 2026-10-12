import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import { createDefaultPoseCreatorClipDraft } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { insertPoseCreatorBeat } from "@/ui/pose-creator/poseCreatorClipMotion";
import { parseAnimaPose } from "@/lib/avatar/poses/animaPose";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import { createActionProject, parseActionImport } from "./actionProject";
import {
  createActionDocument,
  sanitizeReactionSequence,
} from "./actionDocument";
import {
  actionDocumentForPersistence,
  actionSequenceFromTimelineDraft,
  captureActionDocumentForSave,
  canonicalizeActionComponentInsertion,
} from "./actionPersistence";

describe("actionDocumentForPersistence", () => {
  it.each(["", "My Reaction"])(
    "preserves live timeline and name edits during automatic naming (%s)",
    async (typedName) => {
      const document = createActionDocument("reaction");
      let draft = createDefaultPoseCreatorClipDraft(
        DEFAULT_POSE_CREATOR_BASE_POSE,
      );
      let finishLookup!: (name: string) => void;
      const pending = captureActionDocumentForSave(
        () => document,
        () => draft,
        () =>
          new Promise<string>((resolve) => {
            finishLookup = resolve;
          }),
      );
      document.name = typedName;
      // A timeline edit lands while the name lookup is pending.
      draft = insertPoseCreatorBeat(
        draft,
        {
          timeSec: 0.4,
          label: "Smile",
          pose: { expressions: { happy: 0.75 } },
        },
        null,
      );
      finishLookup("New Reaction 1");
      const saved = await pending;
      expect(saved.name).toBe(typedName || "New Reaction 1");
      expect(saved.sequence).toMatchObject({
        schema: "animaPoseClip/2.0",
        beats: [{ id: "smile", label: "Smile", time: 0.4 }],
        expressions: { happy: [{ beat: "smile", v: 0.75 }] },
      });
    },
  );
  it("captures the live timeline and removes declarations unused by that snapshot", () => {
    const document = createActionDocument("reaction");
    document.dependencies = [
      {
        alias: "joy_background",
        content_type: "scene_effect",
        source: {
          type: "builtin",
          content_id: "builtin:scene-effect:background:scene-vfx-emotion-joy",
          version: 1,
        },
      },
      {
        alias: "old_rain",
        content_type: "particle_effect",
        source: {
          type: "builtin",
          content_id: "builtin:particle-effect:rain-cloud",
          version: 1,
        },
      },
    ];
    document.sequence = {
      ...document.sequence,
      events: [
        {
          id: "joy-background",
          time: 0.55,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "joy_background",
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
        id: "joy-background",
        time: 0.7,
        kind: "scene_vfx",
        sceneKind: "background_layers",
        presetId: "joy_background",
      },
    ];

    const persisted = actionDocumentForPersistence(document, draft);

    expect(persisted.sequence.events).toEqual([
      expect.objectContaining({ id: "joy-background", time: 0.7 }),
    ]);
    expect(persisted.dependencies.map((value) => value.alias)).toEqual([
      "joy_background",
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
    );
    const document = createActionDocument("gesture");
    document.name = "Copied Action";
    document.semanticKey = "copied-action";
    const persisted = actionDocumentForPersistence(
      document,
      usePoseCreatorStore.getState().clipDraft,
    );
    const canonical = canonicalizeActionComponentInsertion(persisted);
    expect(persisted.sequence.schema).toBe("animaPoseClip/2.0");
    expect(persisted.sequence.basePose).toBeUndefined();
    expect(canonical.sequence.basePose).toBeUndefined();
    expect(canonical.dependencies).toEqual([]);
    const sample = (clip: unknown) =>
      createAnimaPoseClipProgram(parseAnimaPoseClip(clip), {
        resolvePose: () => null,
      }).sample(0.5);
    const expected = sample(canonical.sequence);
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
      expect(sample(clip)).toEqual(expected);
      expect(store.hydrateClipDocument(clip)).toBe(true);
      expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe("");
    }
    store.resetWorkspace();
  });
});

describe("empty authoring timeline history", () => {
  it("emits an empty Reaction in the same normalized form as editor history", () => {
    const draft = createDefaultPoseCreatorClipDraft("relaxedRest");
    const empty = actionSequenceFromTimelineDraft(draft, "reaction", {
      allowEmpty: true,
    })!;
    expect(empty).toEqual(sanitizeReactionSequence(empty));
    expect(empty).toMatchObject({ schema: "animaPoseClip/2.0", beats: [] });
    expect(empty).not.toHaveProperty("basePose");
  });
  it.each(["pose", "event"])(
    "records the final %s deletion without making empty clips saveable",
    (kind) => {
      const store = usePoseCreatorStore.getState();
      store.resetWorkspace();
      const sequence = {
        schema: "animaPoseClip/2.0",
        id: "last-marker",
        name: "Last marker",
        duration: 4,
        fadeIn: { duration: 0.3 },
        beats:
          kind === "pose"
            ? [{ id: "expression", label: "Expression", time: 1 }]
            : [],
        ...(kind === "pose"
          ? { expressions: { happy: [{ v: 0.6, beat: "expression" }] } }
          : {}),
        events:
          kind === "event"
            ? [
                {
                  id: "hearts",
                  kind: "avatar_vfx",
                  time: 1,
                  effectId: "hearts",
                },
              ]
            : [],
      };
      store.hydrateClipDocument(parseAnimaPoseClip(sequence));
      if (kind === "pose") store.deleteSelectedClipKeyframe();
      else {
        store.selectClipEvent("hearts");
        store.deleteSelectedClipEvent();
      }
      const draft = usePoseCreatorStore.getState().clipDraft;
      const empty = actionSequenceFromTimelineDraft(draft, "reaction", {
        allowEmpty: true,
      });
      expect(empty).toMatchObject({
        schema: "animaPoseClip/2.0",
        id: "last-marker",
        name: "Last marker",
        duration: 4,
        fadeIn: { duration: 0.3 },
        beats: [],
      });
      expect(empty).not.toHaveProperty("expressions");
      expect(empty?.events ?? []).toEqual([]);
      expect(actionSequenceFromTimelineDraft(draft, "reaction")).toBeNull();
      expect(() =>
        actionDocumentForPersistence(createActionDocument("reaction"), draft),
      ).toThrow(/invalid keyframes or events/);
      store.insertClipSFXEventAtPlayhead("new-sound");
      const next = actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        "reaction",
      );
      expect(next?.beats).toEqual([]);
      expect(next?.events).toEqual([
        expect.objectContaining({ kind: "sfx", cueId: "new-sound" }),
      ]);
      store.resetWorkspace();
    },
  );
});

describe("animaPoseClip/2.0 persistence", () => {
  it("saves, exports and imports a 2.0 Gesture with its beats and detail", () => {
    const clip = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../../content/included/gestures/wave-hello/wave-hello.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    );
    const store = usePoseCreatorStore.getState();
    store.resetWorkspace();
    expect(store.hydrateClipDocument(parseAnimaPoseClip(clip))).toBe(true);
    const document = createActionDocument("gesture");
    document.name = "Wave Hello";
    document.semanticKey = "wave_hello";
    const saved = actionDocumentForPersistence(
      document,
      usePoseCreatorStore.getState().clipDraft,
    );
    expect(saved.sequence).toEqual({ ...clip, id: "wave-hello" });
    const imported = parseActionImport(
      JSON.parse(JSON.stringify(createActionProject(saved))),
      "gesture",
    );
    expect(imported.kind === "project" && imported.project.sequence).toEqual(
      saved.sequence,
    );
    store.resetWorkspace();
  });
});
