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

    expect(reaction.sequence).toMatchObject({
      schema: "animaPoseClip/2.0",
      duration: 2,
      beats: [],
      events: [],
    });
    expect(reaction.sequence).not.toHaveProperty("basePose");
  });

  it("starts a two-second Gesture without base endpoints", () => {
    const gesture = createActionDocument("gesture");

    expect(gesture.sequence).toMatchObject({
      schema: "animaPoseClip/2.0",
      duration: 2,
      basePose: "relaxedRest",
      beats: [],
    });
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
      beats: [{ id: "bad", label: "Bad", time: 0 }],
      rotations: { head: [{ q: [0, 0, 0, 1], beat: "bad" }] },
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
    const expressions = { happy: [{ v: 0.8, beat: "captured" }] };
    const sequence = sanitizeReactionSequence({
      schema: "animaPoseClip/2.0",
      basePose: "vrm-t-pose",
      mutedProceduralLayers: ["sway"],
      beats: [{ id: "captured", label: "Captured", time: 0 }],
      joints: { spine: { flexion: [{ v: 4, beat: "captured" }] } },
      rotations: { hips: [{ q: [0, 0, 0, 1], beat: "captured" }] },
      hipsPosition: { y: [{ v: 0.01, beat: "captured" }] },
      hands: { left: [{ preset: "relaxed", beat: "captured" }] },
      contacts: [],
      plantFeet: true,
      expressions,
      events: [{ id: "sparkle", kind: "particle_vfx", effectId: "stars" }],
    });

    expect(sequence).toEqual({
      schema: "animaPoseClip/2.0",
      beats: [{ id: "captured", label: "Captured", time: 0 }],
      expressions,
      events: [{ id: "sparkle", kind: "particle_vfx", effectId: "stars" }],
    });
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
