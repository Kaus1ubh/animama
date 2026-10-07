import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Quaternion, Vector3 } from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { parseAnimaPose } from "@/lib/avatar";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import {
  validateAnimaPoseClipV2,
  type AnimaPoseClipV2,
} from "@/lib/avatar/poses/animaPoseClip/schemaV2";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  resolvePoseCreatorCatalogPose,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import {
  POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  usePoseCreatorStore,
} from "./pose-creator-store";

const example = (name: string): AnimaPoseClipV2 => {
  const result = validateAnimaPoseClipV2(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            `../lib/avatar/motion-authoring/examples/${name}.clip.json`,
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { ...result.clip, generator: { tool: "test" } } as AnimaPoseClipV2;
};

const state = () => usePoseCreatorStore.getState();
const built = () => {
  const clip = buildAnimaPoseClipFromPoseCreatorDraft(
    state().clipDraft,
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
  if (!clip || clip.schema !== "animaPoseClip/2.0")
    throw new Error("expected a 2.0 clip");
  return clip;
};
const beat = (clip: AnimaPoseClipV2, id: string) =>
  clip.beats.find((candidate) => candidate.id === id)!;

describe("pose creator store with an animaPoseClip/2.0 draft", () => {
  beforeEach(() => {
    state().resetWorkspace();
    expect(state().hydrateClipDocument(example("hearty-laugh"))).toBe(true);
  });

  it("shows beats as labelled keyframes with their detail", () => {
    const { keyframes, motion } = state().clipDraft;
    expect(motion?.beats).toHaveLength(7);
    expect(keyframes.map(({ label }) => label)).toEqual([
      "Start",
      "Anticipate",
      "Burst",
      "Laughing",
      "Recover",
      "Rebound",
      "Settle",
    ]);
    expect(keyframes.find(({ id }) => id === "burst")?.detail).toMatchObject({
      channels: expect.any(Number),
    });
  });

  it("round-trips the clip, unknown fields included", () => {
    const original = example("hearty-laugh");
    const clip = built();
    expect(clip).toMatchObject({
      generator: { tool: "test" },
      beats: original.beats,
      joints: original.joints,
      hands: original.hands,
      expressions: original.expressions,
      plantFeet: true,
    });
  });

  it("retimes a beat with its detail, then undoes it", () => {
    const before = built();
    state().moveClipKeyframe("laughing", 1.3);
    const moved = built();
    expect(beat(moved, "laughing").time).toBe(1.3);
    expect(moved.joints!.chest).not.toEqual(before.joints!.chest);
    expect(
      state().clipDraft.keyframes.find(({ id }) => id === "laughing"),
    ).toMatchObject({ time: 1.3 });
    state().undoClip();
    expect(built()).toEqual(before);
  });

  it("relabels, eases and deletes the selected beat", () => {
    state().selectClipKeyframe("recover");
    state().updateSelectedClipKeyframe({ label: "Catch breath" });
    state().updateSelectedClipKeyframe({ ease: "linear" });
    expect(beat(built(), "recover")).toMatchObject({
      label: "Catch breath",
      ease: "linear",
    });
    state().deleteSelectedClipKeyframe();
    expect(built().beats.some(({ id }) => id === "recover")).toBe(false);
    expect(JSON.stringify(built())).not.toContain('"recover"');
  });

  it("applies a Pose tab edit to the beat, re-targeting its detail", () => {
    const clip = built();
    const sample = createAnimaPoseClipProgram(clip, {
      resolvePose: resolvePoseCreatorCatalogPose,
    }).sample(beat(clip, "burst").time).sample;
    const turned = new Quaternion(...sample.humanoid!.head!.rotation!)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2))
      .toArray() as [number, number, number, number];
    state().selectClipKeyframe("burst");
    state().beginClipInlinePoseEdit({
      alias: "burst",
      keyframeId: "burst",
      originalPose: { humanoid: sample.humanoid },
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "",
    });
    state().commitClipInlinePoseEdit(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "edit",
        name: "Edit",
        humanoid: { ...sample.humanoid, head: { rotation: turned } },
        expressions: sample.expressions,
      }),
    );
    const edited = built();
    const head = new Quaternion(
      ...createAnimaPoseClipProgram(edited, {
        resolvePose: resolvePoseCreatorCatalogPose,
      }).sample(beat(edited, "burst").time).sample.humanoid!.head!.rotation!,
    );
    expect(head.angleTo(new Quaternion(...turned))).toBeLessThan(1e-3);
    // Joints the edit left alone keep their keys.
    expect(edited.joints!.rightUpperArm).toEqual(clip.joints!.rightUpperArm);
  });

  it("returns bones and expressions a Pose tab edit reset to the base", () => {
    const clip = built();
    const time = beat(clip, "burst").time;
    const sampleOf = (source: AnimaPoseClipV2) =>
      createAnimaPoseClipProgram(source, {
        resolvePose: resolvePoseCreatorCatalogPose,
      }).sample(time).sample;
    const sample = sampleOf(clip);
    expect(Object.values(sample.expressions ?? {}).some((v) => v > 0.1)).toBe(
      true,
    );
    const { head, ...rest } = sample.humanoid!;
    expect(head?.rotation).toBeDefined();
    state().selectClipKeyframe("burst");
    state().beginClipInlinePoseEdit({
      alias: "burst",
      keyframeId: "burst",
      originalPose: { humanoid: sample.humanoid },
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "",
    });
    // Reset bone (head) and Clear all expressions omit them from the pose.
    state().commitClipInlinePoseEdit(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "edit",
        name: "Edit",
        humanoid: rest,
      }),
    );
    const edited = sampleOf(built());
    const base =
      resolvePoseCreatorCatalogPose("relaxedRest")?.humanoid?.head?.rotation ??
      ([0, 0, 0, 1] as const);
    expect(
      new Quaternion(...edited.humanoid!.head!.rotation!).angleTo(
        new Quaternion(...base),
      ),
    ).toBeLessThan(1e-3);
    for (const value of Object.values(edited.expressions ?? {}))
      expect(value).toBeCloseTo(0, 3);
  });

  it("captures a beat at the playhead and adds a Library Pose as a beat", () => {
    state().setClipCurrentTime(1.0);
    state().captureClipPoseAtPlayhead(
      parseAnimaPose({ schema: "animaPose/1.0", id: "c", name: "C" }),
    );
    expect(built().beats.find(({ time }) => time === 1)).toMatchObject({
      label: "Captured",
    });
    const alias = state().addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "smile",
        name: "Smile",
        expressions: { happy: 1 },
      }),
      "Big smile",
      { timeSec: 3.2 },
    );
    expect(alias).toBe(state().clipDraft.selectedKeyframeId);
    expect(beat(built(), alias!)).toMatchObject({ label: "Big smile" });
  });

  it("adds and removes a base beat at the clip's end", () => {
    state().setClipBaseEndpoint("end", true);
    const end = built().beats.at(-1)!;
    expect(end).toMatchObject({ label: "Base", time: built().duration });
    state().setClipBaseEndpoint("end", false);
    expect(built().beats.at(-1)!.label).not.toBe("Base");
  });

  it("re-poses base beats when the base pose changes", () => {
    state().setClipBaseEndpoint("end", true);
    state().updateClipDraft({ basePose: "hands-on-hips" });
    const clip = built();
    expect(clip.basePose).toBe("hands-on-hips");
    const end = createAnimaPoseClipProgram(clip, {
      resolvePose: resolvePoseCreatorCatalogPose,
    }).sample(clip.duration).sample.humanoid!;
    const handsOnHips =
      resolvePoseCreatorCatalogPose("hands-on-hips")!.humanoid!;
    for (const bone of ["leftUpperArm", "rightUpperArm", "spine"] as const) {
      const expected = handsOnHips[bone]?.rotation ?? [0, 0, 0, 1];
      expect(
        new Quaternion(...end[bone]!.rotation!).angleTo(
          new Quaternion(...expected),
        ),
      ).toBeLessThan(2e-3);
    }
  });
});

describe("pose creator store with a 2.0 Reaction draft", () => {
  it("sets the expressions of the beat at the playhead", () => {
    state().resetWorkspace();
    state().hydrateClipDocument({
      schema: "animaPoseClip/2.0",
      id: "joy",
      name: "Joy",
      duration: 1.2,
      beats: [{ id: "start", label: "Start", time: 0 }],
      expressions: { happy: [{ beat: "start", v: 1 }] },
    });
    state().setClipCurrentTime(0.3);
    state().setClipExpressionsAtPlayhead({ angry: 1 });
    const clip = built();
    expect(clip.beats).toHaveLength(2);
    const sample = createAnimaPoseClipProgram(clip, {
      resolvePose: () => null,
    }).sample(0.3).sample.expressions!;
    expect(sample.angry).toBeCloseTo(1);
    expect(sample.happy).toBeCloseTo(0);
  });
});
