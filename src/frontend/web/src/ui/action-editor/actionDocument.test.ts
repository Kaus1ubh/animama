import { describe, expect, it } from "vitest";
import {
  applyActionAuthoringSnapshot,
  actionClipId,
  actionNameSlug,
  createActionDocument,
  gestureSemanticKey,
  actionAuthoringSnapshot,
  actionAuthoringSnapshotsEqual,
  renameActionDocument,
  sanitizeReactionSequence,
  validateActionDocument,
} from "./actionDocument";

describe("actionDocument", () => {
  it("creates product-specific documents and stable selector candidates", () => {
    expect(gestureSemanticKey("Sparkle Wave!")).toBe("sparkle_wave");
    expect(createActionDocument("gesture")).toMatchObject({
      intent: "gesture",
      name: "",
    });
    expect(createActionDocument("reaction")).toMatchObject({
      name: "",
      semanticKey: "",
      sequence: { id: "new-reaction", name: "New Reaction" },
    });
  });

  it("derives code-friendly clip IDs from Action display names", () => {
    expect(actionNameSlug("  Café Déjà Vu!  ")).toBe("cafe-deja-vu");
    expect(actionClipId("Happy Face Transition", "reaction")).toBe(
      "happy-face-transition",
    );
    expect(actionClipId("✨", "gesture")).toBe("new-gesture");
  });

  it("keeps the embedded clip identity synchronized when an Action is renamed", () => {
    const renamed = renameActionDocument(
      createActionDocument("reaction"),
      "Morning Greeting",
      true,
    );

    expect(renamed.name).toBe("Morning Greeting");
    expect(renamed.sequence.name).toBe("Morning Greeting");
    expect(renamed.sequence.id).toBe("morning-greeting");
  });

  it("keeps Starter-fork selectors distinct when their display name changes", () => {
    const fresh = createActionDocument("gesture");
    expect(renameActionDocument(fresh, "Wave", true).semanticKey).toBe("wave");

    const starterFork = {
      ...fresh,
      name: "Shy Finger Poke Custom",
      semanticKey: "shy_finger_poke_custom_abcdef12",
    };
    expect(
      renameActionDocument(starterFork, "My Shy Gesture", true).semanticKey,
    ).toBe("shy_finger_poke_custom_abcdef12");
  });

  it("starts a new Reaction with an empty authoring timeline", () => {
    const reaction = createActionDocument("reaction");

    expect(reaction.sequence.duration).toBe(2);
    expect(reaction.sequence.poses).toEqual({});
    expect(reaction.sequence.poseKeyframes).toEqual([]);
    expect(reaction.sequence.events).toEqual([]);
  });

  it("starts a two-second Gesture without base endpoints", () => {
    const gesture = createActionDocument("gesture");

    expect(gesture.sequence.duration).toBe(2);
    expect(gesture.sequence.basePose).toBe("relaxedRest");
    expect(gesture.sequence.poses).toEqual({});
    expect(gesture.sequence.poseKeyframes).toEqual([]);
    expect(JSON.stringify(gesture.sequence)).not.toContain("happy");
  });

  it("requires selection guidance only for model-selected Gestures", () => {
    const gestureMessages = validateActionDocument(
      createActionDocument("gesture"),
    ).map((issue) => issue.message);
    const reactionMessages = validateActionDocument(
      createActionDocument("reaction"),
    ).map((issue) => issue.message);

    expect(gestureMessages).toContain(
      "Describe when the AI should choose this Gesture.",
    );
    expect(reactionMessages).not.toContain(
      "Describe when the AI should choose this Gesture.",
    );
  });

  it("blocks unresolved IDs and humanoid Reaction tracks", () => {
    const document = createActionDocument("reaction");
    document.sequence = {
      ...document.sequence,
      poses: { bad: { humanoid: { head: { rotation: [0, 0, 0, 1] } } } },
      events: [{ id: "unknown", time: 0, kind: "sfx", cueId: "missing" }],
    };
    const messages = validateActionDocument(document).map(
      (issue) => issue.message,
    );
    expect(messages).toContain("Map or remove the unknown event ID “missing”.");
    expect(messages).toContain(
      "Reactions cannot contain humanoid pose or bone tracks.",
    );
  });

  it("removes automatically captured motion while preserving Reaction expressions", () => {
    const sequence = sanitizeReactionSequence({
      schema: "animaPoseClip/1.0",
      basePose: "vrm-t-pose",
      defaultTransition: {
        interpolation: {
          humanoidRotation: "slerp",
          humanoidPosition: "linear",
          expression: "linear",
        },
      },
      poses: {
        captured_001: {
          humanoid: {
            hips: { rotation: [0, 0, 0, 1] },
          },
          expressions: { happy: 0.8 },
        },
        body_only: {
          humanoid: {
            spine: { rotation: [0, 0, 0, 1] },
          },
        },
      },
      poseKeyframes: [
        { time: 0, pose: "captured_001" },
        { time: 0.5, pose: "body_only" },
      ],
      events: [{ id: "sparkle", kind: "particle_vfx", effectId: "stars" }],
    });

    expect(sequence.basePose).toBeUndefined();
    expect(sequence.poses).toEqual({
      captured_001: { expressions: { happy: 0.8 } },
    });
    expect(sequence.poseKeyframes).toEqual([{ time: 0, pose: "captured_001" }]);
    expect(sequence.events).toEqual([
      { id: "sparkle", kind: "particle_vfx", effectId: "stars" },
    ]);
    expect(
      (sequence.defaultTransition as Record<string, unknown>).interpolation,
    ).toEqual({ expression: "linear" });
  });

  it("omits neutral expression weights but keeps their timeline landmarks", () => {
    const sequence = sanitizeReactionSequence({
      schema: "animaPoseClip/1.0",
      poses: {
        neutral: { expressions: { happy: 0, angry: 0 } },
        empty: {},
        angry: { expressions: { happy: 0, angry: 1 } },
      },
      poseKeyframes: [
        { time: 0, pose: "neutral" },
        { time: 0.25, pose: "empty" },
        { time: 0.5, pose: "angry" },
      ],
    });

    expect(sequence.poses).toEqual({
      neutral: {},
      empty: {},
      angry: { expressions: { angry: 1 } },
    });
    expect(sequence.poseKeyframes).toEqual([
      { time: 0, pose: "neutral" },
      { time: 0.25, pose: "empty" },
      { time: 0.5, pose: "angry" },
    ]);
  });

  it("snapshots authoring content without metadata or server workflow state", () => {
    const document = createActionDocument("gesture");
    const snapshot = actionAuthoringSnapshot(document);
    const renamed = { ...document, name: "Renamed outside history" };
    const restored = applyActionAuthoringSnapshot(renamed, {
      ...snapshot,
      sequence: { ...snapshot.sequence, duration: 2 },
    });
    expect(restored.name).toBe("Renamed outside history");
    expect(restored.sequence.duration).toBe(2);
    expect(
      actionAuthoringSnapshotsEqual(
        actionAuthoringSnapshot(restored),
        actionAuthoringSnapshot(restored),
      ),
    ).toBe(true);
  });
});
