import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  HAND_PRESETS,
  HAND_SEGMENTS,
  resolveHandBones,
} from "./poseCreatorHandAuthoring";
import { createHandInteractionController } from "./poseCreatorHandInteraction";
function fixture() {
  const nodes = new Map<string, Object3D>();
  for (const side of ["left", "right"])
    for (const segment of HAND_SEGMENTS)
      nodes.set(
        `${side}${segment.id[0].toUpperCase()}${segment.id.slice(1)}`,
        new Object3D(),
      );
  const update = vi.fn();
  const avatar = {
    vrm: {
      humanoid: {
        getNormalizedBoneNode: (name: string) => nodes.get(name) ?? null,
      },
      update,
    },
  } as unknown as Avatar;
  usePoseCreatorStore.setState({
    activeAvatar: avatar,
    loadStatus: "ready",
    authoringMode: "pose",
  });
  return { avatar, nodes, update };
}
let controller: ReturnType<typeof createHandInteractionController>;
beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  controller = createHandInteractionController();
});
afterEach(() => controller.dispose());
describe("hand interactions", () => {
  it("spreads only eligible bases and resumes from manual edits", () => {
    fixture();
    controller.begin("left", ["indexProximal", "indexIntermediate"], "spread");
    controller.update(20);
    controller.end();
    expect(Object.keys(usePoseCreatorStore.getState().boneDrafts)).toEqual([
      "leftIndexProximal",
    ]);
    usePoseCreatorStore.getState().setBoneDraft("leftIndexProximal", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 35, y: 0, z: 0 },
    });
    controller.begin("left", ["indexProximal"], "curl");
    controller.update(15);
    controller.end();
    expect(
      usePoseCreatorStore.getState().boneDrafts.leftIndexProximal
        .rotationDegrees.x,
    ).toBeCloseTo(35);
  });
  it("opening, selection capture and zero adjustment leave a clean draft untouched", () => {
    fixture();
    const before = usePoseCreatorStore.getState().boneDrafts;
    controller.begin("left", ["thumbProximal"], "curl");
    controller.update(0);
    controller.end();
    expect(usePoseCreatorStore.getState().boneDrafts).toBe(before);
    expect(usePoseCreatorStore.getState().isDirty).toBe(false);
    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(0);
  });
  it("a bone disappearing mid-drag rejects the entire sample", () => {
    const { nodes } = fixture();
    controller.begin("both", ["indexProximal"], "curl");
    nodes.delete("rightIndexProximal");
    expect(controller.update(20)).toBe(false);
    expect(
      nodes.get("leftIndexProximal")!.quaternion.equals(new Quaternion()),
    ).toBe(true);
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
  });
  it.each([false, true])(
    "releases its own nested group depth (inline=%s)",
    (inline) => {
      fixture();
      const store = usePoseCreatorStore.getState();
      if (inline)
        store.beginClipInlinePoseEdit({
          alias: "hand",
          keyframeId: "frame",
          originalPose: { humanoid: {} },
          boneDrafts: {},
          expressionDrafts: {},
          draftName: "Hand",
        });
      controller.begin("left", ["indexProximal"], "curl");
      controller.update(20);
      if (inline) store.beginClipUndoGroup();
      else store.beginPoseUndoGroup();
      controller.end();
      expect(usePoseCreatorStore.getState().undoGroup?.depth).toBe(1);
      if (inline) store.endClipUndoGroup();
      else store.endPoseUndoGroup();
      expect(usePoseCreatorStore.getState().undoGroup).toBeNull();
      if (inline) store.undoClip();
      else store.undoPose();
      expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
      if (inline) store.redoClip();
      else store.redoPose();
      expect(Object.keys(usePoseCreatorStore.getState().boneDrafts)).toEqual([
        "leftIndexProximal",
      ]);
      expect(controller.update(45)).toBe(false);
    },
  );
  it.each([false, true])(
    "finishes an active drag before Undo and rejects late events (inline=%s)",
    (inline) => {
      fixture();
      const store = usePoseCreatorStore.getState();
      if (inline)
        store.beginClipInlinePoseEdit({
          alias: "hand",
          keyframeId: "frame",
          originalPose: { humanoid: {} },
          boneDrafts: {},
          expressionDrafts: {},
          draftName: "Hand",
        });
      controller.begin("left", ["indexProximal"], "curl");
      controller.update(20);
      if (inline) store.undoClip();
      else store.undoPose();
      expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
      expect(usePoseCreatorStore.getState().undoGroup).toBeNull();
      expect(controller.update(45)).toBe(false);
      controller.begin("left", ["indexProximal"], "curl");
      if (inline) store.redoClip();
      else store.redoPose();
      expect(Object.keys(usePoseCreatorStore.getState().boneDrafts)).toEqual([
        "leftIndexProximal",
      ]);
      expect(controller.update(45)).toBe(false);
      expect(usePoseCreatorStore.getState().undoGroup).toBeNull();
    },
  );
  it("preserves explicit imported base-valued entries after zero and away-return", () => {
    fixture();
    const store = usePoseCreatorStore.getState();
    const draft = {
      baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
      rotationDegrees: { x: 0, y: 0, z: 0 },
    };
    store.loadPoseDocument(
      {
        itemId: "pose",
        poseId: "pose",
        logicalKey: null,
        revision: "1",
        name: "Imported",
      },
      {
        draftName: "Imported",
        basePose: store.basePose,
        boneDrafts: { leftIndexProximal: draft },
        expressionDrafts: {},
      },
    );
    controller.begin("left", ["indexProximal"], "curl");
    controller.update(0);
    controller.end();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({
      leftIndexProximal: draft,
    });
    expect(usePoseCreatorStore.getState().isDirty).toBe(false);
    controller.begin("left", ["indexProximal"], "curl");
    controller.update(20);
    controller.update(0);
    controller.end();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({
      leftIndexProximal: draft,
    });
    expect(usePoseCreatorStore.getState().isDirty).toBe(false);
    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(0);
  });
  it("exposes 14 distinct segments and asymmetric availability", () => {
    const { avatar, nodes } = fixture();
    nodes.delete("rightThumbProximal");
    expect(HAND_SEGMENTS).toHaveLength(14);
    expect(resolveHandBones(avatar, "both").available).toHaveLength(27);
    expect(resolveHandBones(avatar, "both").unavailable[0].boneName).toBe(
      "rightThumbProximal",
    );
  });
  it("keeps Both asymmetry, repeated previews stable, and a single undo entry", () => {
    const { nodes, update } = fixture();
    nodes
      .get("rightIndexProximal")!
      .quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
    expect(controller.begin("both", ["indexProximal"], "curl")).toBe(true);
    controller.update(20);
    const first = usePoseCreatorStore.getState().boneDrafts;
    controller.update(20);
    expect(usePoseCreatorStore.getState().boneDrafts).toBe(first);
    expect(first.rightIndexProximal.rotationDegrees.x).toBeCloseTo(
      (0.4 * 180) / Math.PI,
    );
    expect(first.leftIndexProximal.rotationDegrees.x).toBeCloseTo(0);
    controller.update(30);
    controller.end();
    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(3);
    const result = usePoseCreatorStore.getState().boneDrafts;
    usePoseCreatorStore.getState().undoPose();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
    usePoseCreatorStore.getState().redoPose();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual(result);
  });
  it("preserves positions, inheritance, other channels and mirror scope", () => {
    fixture();
    const store = usePoseCreatorStore.getState();
    const original = {
      baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
      rotationDegrees: { x: 0, y: 0, z: 0 },
      position: [1, 2, 3] as [number, number, number],
    };
    store.setBoneDraft("leftIndexProximal", original);
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.6 });
    store.setMirrorOppositeBone(true);
    controller.begin("left", ["indexProximal"], "curl");
    controller.update(30);
    controller.update(0);
    controller.end();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({
      leftIndexProximal: original,
    });
    expect(usePoseCreatorStore.getState().expressionDrafts.happy.value).toBe(
      0.6,
    );
  });
  it("leaves existing thumb metacarpals unchanged across presets and adjustments", () => {
    const { nodes } = fixture();
    for (const side of ["left", "right"]) {
      const node = new Object3D();
      node.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
      nodes.set(`${side}ThumbMetacarpal`, node);
      usePoseCreatorStore.getState().setBoneDraft(`${side}ThumbMetacarpal`, {
        baseQuaternion: [0, 0, 0, 1],
        rotationDegrees: { x: 0, y: (0.4 * 180) / Math.PI, z: 0 },
      });
    }
    const original = usePoseCreatorStore.getState().boneDrafts;
    for (const { id: preset } of HAND_PRESETS) {
      expect(controller.preset("both", preset)).toBe(true);
      for (const side of ["left", "right"]) {
        expect(
          usePoseCreatorStore.getState().boneDrafts[`${side}ThumbMetacarpal`],
        ).toEqual(original[`${side}ThumbMetacarpal`]);
        expect(
          nodes
            .get(`${side}ThumbMetacarpal`)!
            .quaternion.angleTo(
              new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4),
            ),
        ).toBeCloseTo(0);
      }
    }
    expect(controller.begin("both", ["thumbMetacarpal"], "curl")).toBe(false);
    expect(
      controller.begin("both", ["thumbProximal", "thumbDistal"], "curl"),
    ).toBe(true);
    controller.update(10);
    controller.end();
    for (const side of ["left", "right"])
      expect(
        usePoseCreatorStore.getState().boneDrafts[`${side}ThumbMetacarpal`],
      ).toEqual(original[`${side}ThumbMetacarpal`]);
  });
  it.each([
    "relaxed",
    "fist",
    "open-spread",
    "open-together",
    "point",
    "peace",
    "thumbs-up",
  ] as const)("%s is one idempotent undoable action", (preset) => {
    fixture();
    expect(controller.preset("left", preset)).toBe(true);
    const first = usePoseCreatorStore.getState().boneDrafts;
    expect(Object.keys(first)).toHaveLength(14);
    expect(controller.preset("left", preset)).toBe(true);
    expect(usePoseCreatorStore.getState().boneDrafts).toBe(first);
    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(1);
  });
  it("rejects invalid samples without partial store or Avatar edits", () => {
    const { nodes } = fixture();
    controller.begin("both", ["indexProximal"], "curl");
    expect(controller.update(NaN)).toBe(false);
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
    expect(
      nodes.get("leftIndexProximal")!.quaternion.equals(new Quaternion()),
    ).toBe(true);
    expect(controller.lastError).toMatch(/Invalid/);
  });
  it("rejects stale updates after replacement without closing the replacement group", () => {
    fixture();
    controller.begin("left", ["indexProximal"], "curl");
    controller.update(20);
    usePoseCreatorStore.getState().startNewPose();
    usePoseCreatorStore.getState().beginPoseUndoGroup();
    const group = usePoseCreatorStore.getState().undoGroup;
    expect(controller.update(50)).toBe(false);
    controller.end();
    expect(usePoseCreatorStore.getState().undoGroup).toBe(group);
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
  });
  it("routes interactions into inline history and ends on Avatar change", () => {
    fixture();
    usePoseCreatorStore.getState().beginClipInlinePoseEdit({
      alias: "hand",
      keyframeId: "frame",
      originalPose: { humanoid: {} },
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "Hand",
    });
    expect(controller.begin("left", ["indexProximal"], "curl")).toBe(true);
    controller.update(20);
    controller.end();
    expect(usePoseCreatorStore.getState().inlinePoseUndoHistory).toHaveLength(
      1,
    );
    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(0);
    controller.begin("left", ["indexDistal"], "curl");
    usePoseCreatorStore.getState().setActiveAvatar(null);
    expect(controller.update(30)).toBe(false);
  });
});
