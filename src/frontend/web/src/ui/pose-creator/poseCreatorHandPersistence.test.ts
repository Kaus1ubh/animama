import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Object3D, Quaternion } from "three";
import { parseAnimaPose, parseAnimaPoseClip, type Avatar } from "@/lib/avatar";
import { retargetPoseForVrm0 } from "@/lib/avatar/poses/poseRetargeting";
import {
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import {
  buildPoseCreatorAnimaPose,
  createPoseCreatorDraftsFromAnimaPose,
  formatPoseCreatorAnimaPoseJson,
} from "./poseCreatorAuthoring";
import { HAND_SEGMENTS } from "./poseCreatorHandAuthoring";
import { createHandInteractionController } from "./poseCreatorHandInteraction";

function fixture(version: "0" | "1" = "1") {
  const nodes = new Map<string, Object3D>();
  for (const side of ["left", "right"])
    for (const segment of HAND_SEGMENTS)
      nodes.set(
        `${side}${segment.id[0].toUpperCase()}${segment.id.slice(1)}`,
        new Object3D(),
      );
  nodes.set("leftHand", new Object3D());
  const avatar = {
    forgetPose: vi.fn(),
    vrm: {
      meta: { metaVersion: version },
      humanoid: {
        getNormalizedBoneNode: (name: string) => nodes.get(name) ?? null,
        resetNormalizedPose: () =>
          nodes.forEach((node) => node.quaternion.identity()),
      },
      update: vi.fn(),
    },
  } as unknown as Avatar;
  usePoseCreatorStore.setState({
    activeAvatar: avatar,
    loadStatus: "ready",
    authoringMode: "pose",
  });
  return avatar;
}
function exportCurrent() {
  const { boneDrafts, expressionDrafts } = usePoseCreatorStore.getState();
  return buildPoseCreatorAnimaPose(boneDrafts, expressionDrafts, {
    parentPose: null,
  })!;
}
let controller: ReturnType<typeof createHandInteractionController>;
beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  controller = createHandInteractionController();
});
afterEach(() => controller.dispose());

describe("hand edits through existing pose content paths", () => {
  it("keeps intentionally straightened joints explicit through export and clip insertion", () => {
    fixture();
    usePoseCreatorStore
      .getState()
      .setBasePose(POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID);
    controller.preset("right", "fist");
    controller.begin("right", ["indexIntermediate"], "curl");
    controller.update(-80);
    controller.end();
    const saved = parseAnimaPose(
      JSON.parse(formatPoseCreatorAnimaPoseJson(exportCurrent())),
    );
    const alias = usePoseCreatorStore
      .getState()
      .addPoseToClip(saved, "straightened", { timeSec: 0 })!;
    const inserted = usePoseCreatorStore.getState().clipDraft.poses[alias];
    if (!("humanoid" in inserted)) throw new Error("Expected inline pose");
    const rotation = inserted.humanoid!.rightIndexIntermediate!.rotation!;
    expect(new Quaternion(...rotation).angleTo(new Quaternion())).toBeLessThan(
      1e-7,
    );
    expect(saved.humanoid!.rightIndexIntermediate!.rotation).toBeDefined();
  });
  it.each(["open-spread", "open-together"] as const)(
    "keeps explicitly opened finger joints when inserting %s over the clip base",
    (preset) => {
      fixture();
      usePoseCreatorStore
        .getState()
        .setBasePose(POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID);
      expect(controller.preset("both", "fist")).toBe(true);
      expect(controller.preset("right", preset)).toBe(true);
      const saved = parseAnimaPose(
        JSON.parse(formatPoseCreatorAnimaPoseJson(exportCurrent())),
      );
      const alias = usePoseCreatorStore
        .getState()
        .addPoseToClip(saved, "open-hand", { timeSec: 0 });
      expect(alias).not.toBeNull();
      const inserted = usePoseCreatorStore.getState().clipDraft.poses[alias!];
      expect(inserted).toHaveProperty("humanoid");
      if (!("humanoid" in inserted)) throw new Error("Expected inline pose");
      const rotation = inserted.humanoid!.rightIndexIntermediate!.rotation!;
      expect(
        new Quaternion().fromArray(rotation).angleTo(new Quaternion()),
      ).toBeLessThan(1e-7);
    },
  );

  it("round-trips preset and relative edits with wrist, positions and expressions intact", () => {
    const avatar = fixture();
    const store = usePoseCreatorStore.getState();
    const draft = {
      baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
      rotationDegrees: { x: 12, y: 0, z: 0 },
      position: [0.01, 0.02, 0.03] as [number, number, number],
    };
    store.setBoneDraft("leftHand", draft);
    store.setBoneDraft("leftIndexProximal", draft);
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.7 });
    expect(controller.preset("left", "fist")).toBe(true);
    expect(
      controller.begin("left", ["indexIntermediate", "indexDistal"], "curl"),
    ).toBe(true);
    expect(controller.update(-15)).toBe(true);
    controller.end();
    const saved = exportCurrent();
    const imported = parseAnimaPose(
      JSON.parse(formatPoseCreatorAnimaPoseJson(saved)),
    );
    const reopened = createPoseCreatorDraftsFromAnimaPose(
      avatar,
      imported,
      POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
    );
    const exportedAgain = buildPoseCreatorAnimaPose(
      reopened.boneDrafts,
      reopened.expressionDrafts,
      { parentPose: null },
    )!;
    expect(exportedAgain.expressions).toEqual({ happy: 0.7 });
    expect(exportedAgain.humanoid?.leftHand).toEqual(saved.humanoid?.leftHand);
    expect(exportedAgain.humanoid?.leftIndexProximal?.position).toEqual(
      draft.position,
    );
    expect(Object.keys(exportedAgain.humanoid!)).toHaveLength(16);
    for (const name of Object.keys(saved.humanoid!) as Array<
      keyof NonNullable<typeof saved.humanoid>
    >) {
      const actual = exportedAgain.humanoid![name]!.rotation!;
      expect(
        new Quaternion()
          .fromArray(actual)
          .angleTo(
            new Quaternion().fromArray(saved.humanoid![name]!.rotation!),
          ),
      ).toBeLessThan(1e-7);
    }
  });

  it("commits hand edits as one clip edit, and cancellation preserves the original keyframe", () => {
    fixture();
    usePoseCreatorStore.getState().hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "hand-clip",
        name: "Hand clip",
        duration: 1,
        poses: { hand: { humanoid: { leftHand: { rotation: [0, 0, 0, 1] } } } },
        poseKeyframes: [{ time: 0, pose: "hand" }],
      }),
    );
    const original = usePoseCreatorStore.getState().clipDraft.poses.hand!;
    const begin = () =>
      usePoseCreatorStore.getState().beginClipInlinePoseEdit({
        alias: "hand",
        keyframeId: usePoseCreatorStore.getState().clipDraft.keyframes[0]!.id,
        originalPose: original,
        boneDrafts: {},
        expressionDrafts: {},
        draftName: "Hand",
      });
    expect(usePoseCreatorStore.getState().authoringMode).toBe("clip");
    expect(controller.preset("both", "fist")).toBe(false);
    begin();
    expect(usePoseCreatorStore.getState().authoringMode).toBe("clip");
    expect(controller.preset("both", "fist")).toBe(true);
    const edited = exportCurrent();
    usePoseCreatorStore.getState().commitClipInlinePoseEdit(edited);
    const committed = usePoseCreatorStore.getState().clipDraft.poses.hand;
    expect(committed).toHaveProperty("humanoid");
    if (!("humanoid" in committed)) throw new Error("Expected inline pose");
    expect(Object.keys(committed.humanoid!)).toHaveLength(30);
    for (const name of Object.keys(edited.humanoid!) as Array<
      keyof NonNullable<typeof edited.humanoid>
    >) {
      expect(
        new Quaternion()
          .fromArray(committed.humanoid![name]!.rotation!)
          .angleTo(
            new Quaternion().fromArray(edited.humanoid![name]!.rotation!),
          ),
      ).toBeLessThan(1e-7);
    }
    usePoseCreatorStore.getState().undoClip();
    expect(usePoseCreatorStore.getState().clipDraft.poses.hand).toEqual(
      original,
    );
    usePoseCreatorStore.getState().redoClip();
    expect(usePoseCreatorStore.getState().clipDraft.poses.hand).toEqual(
      committed,
    );
    usePoseCreatorStore.getState().undoClip();
    begin();
    expect(controller.preset("left", "fist")).toBe(true);
    usePoseCreatorStore.getState().cancelClipInlinePoseEdit();
    expect(usePoseCreatorStore.getState().clipDraft.poses.hand).toEqual(
      original,
    );
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
  });

  it("saves canonical hand rotations independent of model metadata before runtime retargeting", () => {
    fixture("1");
    controller.preset("left", "fist");
    const canonical = exportCurrent();
    usePoseCreatorStore.getState().resetWorkspace();
    fixture("0");
    controller.preset("left", "fist");
    const legacyModelSave = exportCurrent();
    expect(legacyModelSave).toEqual(canonical);
    const runtime = retargetPoseForVrm0(legacyModelSave);
    const authored = canonical.humanoid!.leftIndexProximal!.rotation!;
    expect(runtime.humanoid!.leftIndexProximal!.rotation).toEqual([
      -authored[0],
      authored[1],
      -authored[2],
      authored[3],
    ]);
    expect(legacyModelSave).toEqual(canonical);
  });
});
