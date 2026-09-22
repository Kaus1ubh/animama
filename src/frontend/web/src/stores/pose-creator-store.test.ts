import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPose, parseAnimaPoseClip, type Avatar } from "@/lib/avatar";
import { sampleAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { getResolvedAvatarPose } from "@/lib/avatar/poses/catalog";
import { buildAnimaPoseClipFromPoseCreatorDraft } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import type { PoseCreatorModelSource } from "@/ui/pose-creator/poseCreatorPreview";
import {
  capturePoseCreatorSubmittedDraft,
  POSE_CREATOR_UNDO_HISTORY_LIMIT,
  POSE_CREATOR_BASE_POSE_OPTIONS,
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  selectCanRedoClip,
  selectCanRedoPose,
  selectCanUndoClip,
  selectCanUndoPose,
  usePoseCreatorStore,
} from "./pose-creator-store";

function model(key: string): PoseCreatorModelSource {
  return {
    key,
    sourceType: "resolved_entry",
    animaId: `anima-${key}`,
    effectiveRevision: `revision-${key}`,
    contentRevision: `content-${key}`,
    displayName: key,
    versionLabel: "Built-in v1",
    sourceLabel: "Preview Anima",
    runtimeId: "primary",
    configSchemaVersion: 1,
    config: {},
  };
}

describe("pose creator model selection", () => {
  beforeEach(() => {
    usePoseCreatorStore.getState().resetWorkspace();
  });

  it("selects Left Upper Arm for a fresh pose and preserves the user's selection across helper and model changes", () => {
    const store = usePoseCreatorStore.getState();
    expect(store.selectedBone).toBe("leftUpperArm");
    store.setSelectedBone("head");
    store.setBoneHelperNodesVisible(false);
    store.setModelSource(model("second"));
    store.setBoneHelperNodesVisible(true);
    expect(usePoseCreatorStore.getState().selectedBone).toBe("head");
    store.startNewPose();
    expect(usePoseCreatorStore.getState().selectedBone).toBe("leftUpperArm");
  });

  it("preserves pose and clip authoring data across model switches", () => {
    const store = usePoseCreatorStore.getState();
    store.setModelSource(model("first"));
    store.setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 10, y: 0, z: 0 },
    });
    store.updateClipDraft({ name: "Keep this clip" });

    usePoseCreatorStore.getState().setModelSource(model("second"));
    const switched = usePoseCreatorStore.getState();

    expect(switched.selectedSource?.key).toBe("second");
    expect(switched.boneDrafts.head?.rotationDegrees.x).toBe(10);
    expect(switched.clipDraft.name).toBe("Keep this clip");
    expect(switched.clipDraft.isDirty).toBe(true);
  });

  it.each(["blank", "saved"])(
    "drops another creator's pose scratch state when opening a %s document",
    (documentKind) => {
      const store = usePoseCreatorStore.getState();
      store.setBoneDraft("leftUpperArm", {
        baseQuaternion: [0, 0, 0, 1],
        rotationDegrees: { x: 70, y: 0, z: 0 },
      });
      store.setExpressionDraft("happy", { baseValue: 0, value: 1 });
      store.setSelectedBone("head");
      if (documentKind === "blank") {
        store.resetClipDraft("New Reaction");
      } else {
        store.hydrateClipDocument(
          parseAnimaPoseClip({
            schema: "animaPoseClip/1.0",
            id: "saved-reaction",
            name: "Saved Reaction",
            duration: 1,
            poses: { expression: { expressions: { sad: 0.4 } } },
            poseKeyframes: [{ time: 0, pose: "expression" }],
          }),
        );
        expect(
          usePoseCreatorStore.getState().clipDraft.poses.expression,
        ).toEqual({
          expressions: { sad: 0.4 },
        });
      }
      const next = usePoseCreatorStore.getState();
      expect(next.boneDrafts).toEqual({});
      expect(next.expressionDrafts).toEqual({});
      expect(next.selectedBone).toBe("leftUpperArm");
      expect(next.poseUndoHistory).toEqual([]);
      expect(next.poseRedoHistory).toEqual([]);
      expect(next.isDirty).toBe(false);
    },
  );

  it("hydrates exact Asset documents as clean Clip workspaces", () => {
    const hydrated = usePoseCreatorStore.getState().hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "asset-clip",
        name: "Asset Clip",
        duration: 1,
        poses: { first: { ref: "relaxedRest" } },
        poseKeyframes: [{ time: 0, pose: "first" }],
      }),
    );
    const store = usePoseCreatorStore.getState();

    expect(hydrated).toBe(true);
    expect(store.authoringMode).toBe("clip");
    expect(store.clipDraft.name).toBe("Asset Clip");
    expect(store.clipDraft.poses.first).toEqual({ ref: "relaxedRest" });
    expect(store.clipDraft.isDirty).toBe(false);
  });

  it("preserves no external base for a motion-free creator document", () => {
    const hydrated = usePoseCreatorStore.getState().hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "expression-only-reaction",
        name: "Expression-only Reaction",
        duration: 1,
        poses: { expression: { expressions: { happy: 0.65 } } },
        poseKeyframes: [{ time: 0, pose: "expression" }],
      }),
    );

    expect(hydrated).toBe(true);
    expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe("");
  });

  it("preserves an explicit playhead while hydrating an in-place effect update", () => {
    const hydrated = usePoseCreatorStore.getState().hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "effect-reaction",
        name: "Effect Reaction",
        duration: 1,
        poses: {},
        poseKeyframes: [],
        events: [
          {
            id: "sparkles",
            time: 0.6,
            kind: "particle_vfx",
            effectId: "sparkles",
            duration: 0.2,
          },
        ],
      }),
      { fallbackBasePose: "relaxedRest", currentTimeSec: 0.6 },
    );

    expect(hydrated).toBe(true);
    expect(usePoseCreatorStore.getState().clipDraft.currentTimeSec).toBe(0.6);
    expect(usePoseCreatorStore.getState().clipDraft.events).toHaveLength(1);
  });

  it("plays and restarts an event-only clip", () => {
    const hydrated = usePoseCreatorStore.getState().hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "event-only",
        name: "Event only",
        duration: 1,
        poses: {},
        poseKeyframes: [],
        events: [
          {
            id: "hearts",
            time: 0,
            kind: "particle_vfx",
            effectId: "hearts",
            duration: 1,
          },
        ],
      }),
    );

    expect(hydrated).toBe(true);
    expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe("");
    usePoseCreatorStore.getState().playClipPreview();
    expect(usePoseCreatorStore.getState().clipPlaybackPlaying).toBe(true);

    usePoseCreatorStore.getState().stopClipPreview();
    usePoseCreatorStore.getState().restartClipPreview();
    expect(usePoseCreatorStore.getState().clipPlaybackPlaying).toBe(true);
  });

  it("exposes only the neutral authoring base and the model T-pose", () => {
    expect(POSE_CREATOR_BASE_POSE_OPTIONS.map((option) => option.id)).toEqual([
      "relaxedRest",
      POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
    ]);
  });

  it("restores relaxed-rest when resetting an empty Clip", () => {
    const applyPose = vi.fn();
    const clearAllExpressionOverrides = vi.fn();
    const update = vi.fn();
    usePoseCreatorStore.setState({
      activeAvatar: {
        applyPose,
        clearAllExpressionOverrides,
        vrm: { update },
      } as unknown as Avatar,
    });

    usePoseCreatorStore.getState().resetClipDraft();

    expect(applyPose).toHaveBeenCalledWith("relaxedRest");
    expect(clearAllExpressionOverrides).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(0);
  });

  it("starts a new Pose without discarding the in-progress Clip", () => {
    const store = usePoseCreatorStore.getState();
    store.setDraftName("First pose");
    store.setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 10, y: 0, z: 0 },
    });
    store.updateClipDraft({ name: "Keep this clip" });

    usePoseCreatorStore.getState().startNewPose();
    const reset = usePoseCreatorStore.getState();

    expect(reset.draftName).toBe("");
    expect(reset.boneDrafts).toEqual({});
    expect(reset.expressionDrafts).toEqual({});
    expect(reset.savedPoseIdentity).toBeNull();
    expect(reset.isDirty).toBe(false);
    expect(reset.clipDraft.name).toBe("Keep this clip");
    expect(reset.clipDraft.isDirty).toBe(true);
  });

  it("enables opposite-bone mirroring by default and after a workspace reset", () => {
    expect(usePoseCreatorStore.getState().mirrorOppositeBone).toBe(true);

    usePoseCreatorStore.getState().setMirrorOppositeBone(false);
    expect(usePoseCreatorStore.getState().mirrorOppositeBone).toBe(false);

    usePoseCreatorStore.getState().resetWorkspace();
    expect(usePoseCreatorStore.getState().mirrorOppositeBone).toBe(true);
  });

  it("acknowledges saved identity without clearing newer edits or a replacement session", () => {
    const store = usePoseCreatorStore.getState();
    store.setDraftName("Saved pose");
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.3 });
    const submittedDraft = capturePoseCreatorSubmittedDraft(
      usePoseCreatorStore.getState(),
    );
    const sessionToken = usePoseCreatorStore.getState().poseSessionToken;
    const savedIdentity = {
      itemId: "item",
      poseId: "pose",
      logicalKey: "local:pose:saved",
      revision: "r1",
      name: "Saved pose",
    };
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.8 });
    expect(
      store.acknowledgePoseSave({
        sessionToken,
        submittedDraft,
        savedIdentity,
      }),
    ).toBe(true);
    expect(usePoseCreatorStore.getState().savedPoseIdentity).toEqual(
      savedIdentity,
    );
    expect(usePoseCreatorStore.getState().isDirty).toBe(true);
    expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
      0.8,
    );
    store.startNewPose();
    expect(
      store.acknowledgePoseSave({
        sessionToken,
        submittedDraft,
        savedIdentity,
      }),
    ).toBe(false);
    expect(usePoseCreatorStore.getState().savedPoseIdentity).toBeNull();
  });

  it("loads Local identity and customizes an Included snapshot without browser storage", () => {
    const storage = {
      getItem: vi.fn(() => '{"drafts":[{"id":"old"}]}'),
      setItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage: storage });
    const store = usePoseCreatorStore.getState();
    const replacement = {
      draftName: "Pose",
      basePose: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
      boneDrafts: {},
      expressionDrafts: { happy: { baseValue: 0, value: 0.4 } },
    };
    const identity = {
      itemId: "local",
      poseId: "pose",
      logicalKey: "local:pose:pose",
      revision: "r1",
      name: "Pose",
    };
    store.loadPoseDocument(identity, replacement);
    expect(usePoseCreatorStore.getState().isDirty).toBe(false);
    const token = usePoseCreatorStore.getState().poseSessionToken;
    store.loadPoseDocument(null, replacement);
    expect(usePoseCreatorStore.getState().poseSessionToken).not.toBe(token);
    expect(usePoseCreatorStore.getState().savedPoseIdentity).toBeNull();
    expect(usePoseCreatorStore.getState().isDirty).toBe(true);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("copies saved pose snapshots into a Clip with or without a keyframe", () => {
    const store = usePoseCreatorStore.getState();
    const pose = parseAnimaPose({
      schema: "animaPose/1.0",
      id: "jumping-jack",
      name: "Jumping Jack",
      humanoid: { head: { rotation: [0, 0, 0, 1] } },
    });

    const availableAlias = store.addPoseToClip(pose, "Jumping Jack");
    const keyframedAlias = usePoseCreatorStore
      .getState()
      .addPoseToClip(pose, "Jumping Jack", { atPlayhead: true });
    const clip = usePoseCreatorStore.getState().clipDraft;

    expect(availableAlias).toBe("jumpingJack");
    expect(keyframedAlias).toBe("jumpingJack_2");
    expect(clip.poses[availableAlias!]).toMatchObject({
      humanoid: { head: { rotation: [0, 0, 0, 1] } },
    });
    expect(clip.keyframes).toHaveLength(1);
    expect(clip.keyframes[0]?.pose).toBe(keyframedAlias);
    expect(clip.selectedPoseAlias).toBe(keyframedAlias);
    expect(clip.isDirty).toBe(true);
  });

  it("inserts a pose at an explicit drop time in one edit without a preliminary seek", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipCurrentTime(0.1, { snap: false });
    const before = usePoseCreatorStore.getState().clipDraft;
    const updates: number[] = [];
    const unsubscribe = usePoseCreatorStore.subscribe((state) => {
      updates.push(state.clipDraft.currentTimeSec);
    });
    const pose = parseAnimaPose({
      schema: "animaPose/1.0",
      id: "dropped-pose",
      name: "Dropped pose",
      expressions: { happy: 0.7 },
    });

    const alias = store.addPoseToClip(pose, pose.name, {
      timeSec: 0.37,
      atPlayhead: true,
    });
    unsubscribe();
    const state = usePoseCreatorStore.getState();
    expect(updates).toEqual([0.37]);
    expect(state.clipPlaybackAbsoluteTimeSec).toBe(0.37);
    expect(state.clipDraft.keyframes).toEqual([
      expect.objectContaining({ pose: alias, time: 0.37 }),
    ]);
    expect(state.clipDraft.selectedKeyframeId).toBe(
      state.clipDraft.keyframes[0]?.id,
    );
    expect(state.clipPlaybackPlaying).toBe(false);
    expect(state.clipUndoHistory).toHaveLength(1);

    store.undoClip();
    expect(usePoseCreatorStore.getState().clipDraft.poses).toEqual(
      before.poses,
    );
    expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual(
      before.keyframes,
    );
  });

  it("selects only the dropped pose when an effect was previously selected", () => {
    const store = usePoseCreatorStore.getState();
    store.insertClipSFXEventAtPlayhead("chime");
    expect(
      usePoseCreatorStore.getState().clipDraft.selectedEventId,
    ).not.toBeNull();
    store.addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "dropped-pose",
        name: "Dropped pose",
        expressions: { happy: 0.7 },
      }),
      "Dropped pose",
      { timeSec: 0.4 },
    );
    const clip = usePoseCreatorStore.getState().clipDraft;
    expect(clip.selectedEventId).toBeNull();
    expect(clip.selectedKeyframeId).toBe(clip.keyframes[0]?.id);
  });

  it("replaces an occupied pose timestamp and restores its complete contents with one undo", () => {
    const store = usePoseCreatorStore.getState();
    const pose = parseAnimaPose({
      schema: "animaPose/1.0",
      id: "happy",
      name: "Happy",
      expressions: { happy: 0.5 },
    });
    store.addPoseToClip(pose, pose.name, { timeSec: 0.6 });
    const before = usePoseCreatorStore.getState().clipDraft;
    store.setClipCurrentTime(0.2, { snap: false });
    const replacement = store.addPoseToClip(
      { ...pose, expressions: { happy: 1 } },
      "Happier",
      { timeSec: 0.6 },
    );
    const after = usePoseCreatorStore.getState().clipDraft;
    expect(after.keyframes).toEqual([
      { ...before.keyframes[0], pose: replacement },
    ]);
    expect(after.currentTimeSec).toBe(0.6);
    expect(after.selectedKeyframeId).toBe(before.keyframes[0]?.id);

    store.undoClip();
    expect(usePoseCreatorStore.getState().clipDraft.poses).toEqual(
      before.poses,
    );
    expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual(
      before.keyframes,
    );
  });

  it.each([-1, 5])(
    "clamps an explicit pose insertion time %s to the timeline",
    (timeSec) => {
      const store = usePoseCreatorStore.getState();
      const pose = parseAnimaPose({
        schema: "animaPose/1.0",
        id: "boundary",
        name: "Boundary",
        expressions: { happy: 1 },
      });
      const expected = Math.max(0, Math.min(store.clipDraft.duration, timeSec));
      store.addPoseToClip(pose, pose.name, { timeSec });
      expect(usePoseCreatorStore.getState().clipDraft.keyframes[0]?.time).toBe(
        expected,
      );
    },
  );

  it("copies inherited and directly authored channels from a parented pose", () => {
    const store = usePoseCreatorStore.getState();
    const pose = parseAnimaPose({
      schema: "animaPose/1.0",
      id: "surprised-blink",
      name: "Surprised Blink",
      parent: { ref: "relaxedRest" },
      expressions: { surprised: 1, blink: 1 },
    });

    const alias = store.addPoseToClip(pose, pose.name, { atPlayhead: true });

    expect(
      usePoseCreatorStore.getState().clipDraft.poses[alias!],
    ).toMatchObject({
      humanoid: { head: { rotation: [0, 0, 0, 1] } },
      expressions: { surprised: 1, blink: 1 },
    });
  });

  it("writes sparse expression landmarks directly at the playhead", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipCurrentTime(0.3, { snap: false });
    store.setClipExpressionsAtPlayhead({ happy: 0.4, angry: 0 });

    let clip = usePoseCreatorStore.getState().clipDraft;
    expect(clip.keyframes).toHaveLength(1);
    const alias = clip.keyframes[0]?.pose;
    expect(alias).toBeTruthy();
    expect(clip.poses[alias!]).toEqual({ expressions: { happy: 0.4 } });

    usePoseCreatorStore
      .getState()
      .setClipExpressionsAtPlayhead({ happy: 0.75 });
    clip = usePoseCreatorStore.getState().clipDraft;
    expect(clip.keyframes).toHaveLength(1);
    expect(Object.keys(clip.poses)).toEqual([alias]);
    expect(clip.poses[alias!]).toEqual({ expressions: { happy: 0.75 } });

    usePoseCreatorStore.getState().setClipExpressionsAtPlayhead({ happy: 0 });
    clip = usePoseCreatorStore.getState().clipDraft;
    expect(clip.poses[alias!]).toEqual({});
    expect(clip.validationIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "empty-inline-pose" }),
      ]),
    );
  });

  it("clears clip expression preview state when starting a new timeline", () => {
    const applyPose = vi.fn();
    const clearAllExpressionOverrides = vi.fn();
    const update = vi.fn();
    usePoseCreatorStore.setState({
      activeAvatar: {
        applyPose,
        clearAllExpressionOverrides,
        vrm: { update },
      } as never,
    });
    const store = usePoseCreatorStore.getState();
    store.setClipExpressionsAtPlayhead({ angry: 1 });
    const previousClearRevision =
      usePoseCreatorStore.getState().clipPreviewClearRevision;

    usePoseCreatorStore.getState().resetClipDraft("New Reaction");
    const reset = usePoseCreatorStore.getState();

    expect(reset.clipDraft.name).toBe("New Reaction");
    expect(reset.clipDraft.keyframes).toEqual([]);
    expect(reset.clipDraft.poses).toEqual({});
    expect(reset.clipPlaybackAbsoluteTimeSec).toBe(0);
    expect(reset.clipPreviewClearRevision).toBe(previousClearRevision + 1);
    expect(applyPose).toHaveBeenCalledWith("relaxedRest");
    expect(clearAllExpressionOverrides).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(0);
  });
});

describe("pose creator undo and redo history", () => {
  beforeEach(() => {
    usePoseCreatorStore.getState().resetWorkspace();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps independent Pose and Clip histories across tab switches", () => {
    const store = usePoseCreatorStore.getState();
    store.setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 10, y: 0, z: 0 },
    });
    store.addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "clip-pose",
        name: "Clip pose",
        humanoid: { head: { rotation: [0, 0, 0, 1] } },
      }),
      "clipPose",
      { atPlayhead: true },
    );

    expect(selectCanUndoPose(usePoseCreatorStore.getState())).toBe(true);
    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(true);

    store.setAuthoringMode("clip");
    usePoseCreatorStore.getState().undoClip();
    expect(Object.keys(usePoseCreatorStore.getState().clipDraft.poses)).toEqual(
      [],
    );
    expect(usePoseCreatorStore.getState().boneDrafts.head).toBeDefined();
    expect(selectCanRedoClip(usePoseCreatorStore.getState())).toBe(true);

    usePoseCreatorStore.getState().setAuthoringMode("pose");
    usePoseCreatorStore.getState().undoPose();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(true);

    usePoseCreatorStore.getState().setAuthoringMode("clip");
    usePoseCreatorStore.getState().redoClip();
    expect(Object.keys(usePoseCreatorStore.getState().clipDraft.poses)).toEqual(
      ["clipPose"],
    );
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(true);
  });

  it("collapses a continuous Pose interaction into one step", () => {
    const store = usePoseCreatorStore.getState();
    store.beginPoseUndoGroup();
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.2 });
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.6 });
    store.setExpressionDraft("happy", { baseValue: 0, value: 1 });
    store.endPoseUndoGroup();

    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(1);
    usePoseCreatorStore.getState().undoPose();
    expect(usePoseCreatorStore.getState().expressionDrafts).toEqual({});
    expect(selectCanUndoPose(usePoseCreatorStore.getState())).toBe(false);
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().redoPose();
    expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
      1,
    );
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(false);
  });

  it("discards the Pose future only after a new committed edit", () => {
    const store = usePoseCreatorStore.getState();
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.5 });
    store.undoPose();
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(true);

    usePoseCreatorStore.getState().beginPoseUndoGroup();
    usePoseCreatorStore.getState().endPoseUndoGroup();
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(true);

    usePoseCreatorStore
      .getState()
      .setExpressionDraft("happy", { baseValue: 0, value: 0.75 });
    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(false);
  });

  it("caps Pose history at the configured limit", () => {
    for (
      let index = 1;
      index <= POSE_CREATOR_UNDO_HISTORY_LIMIT + 5;
      index += 1
    ) {
      usePoseCreatorStore.getState().setExpressionDraft("happy", {
        baseValue: 0,
        value: index,
      });
    }

    expect(usePoseCreatorStore.getState().poseUndoHistory).toHaveLength(
      POSE_CREATOR_UNDO_HISTORY_LIMIT,
    );
    for (let index = 0; index < POSE_CREATOR_UNDO_HISTORY_LIMIT; index += 1) {
      usePoseCreatorStore.getState().undoPose();
    }
    expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
      5,
    );
    expect(selectCanUndoPose(usePoseCreatorStore.getState())).toBe(false);
    expect(usePoseCreatorStore.getState().poseRedoHistory).toHaveLength(
      POSE_CREATOR_UNDO_HISTORY_LIMIT,
    );
  });

  it("groups Clip marker movement and restores selection and playhead", () => {
    const store = usePoseCreatorStore.getState();
    expect(
      store.hydrateClipDocument(
        parseAnimaPoseClip({
          schema: "animaPoseClip/1.0",
          id: "move-test",
          name: "Move test",
          duration: 2,
          poses: { first: { ref: "relaxedRest" } },
          poseKeyframes: [{ time: 0.25, pose: "first" }],
        }),
      ),
    ).toBe(true);
    const keyframeId =
      usePoseCreatorStore.getState().clipDraft.keyframes[0]!.id;
    usePoseCreatorStore.getState().selectClipKeyframe(keyframeId);
    usePoseCreatorStore.getState().beginClipUndoGroup();
    usePoseCreatorStore.getState().moveClipKeyframe(keyframeId, 0.5);
    usePoseCreatorStore.getState().moveClipKeyframe(keyframeId, 1.25);
    usePoseCreatorStore.getState().endClipUndoGroup();

    expect(usePoseCreatorStore.getState().clipUndoHistory).toHaveLength(1);
    usePoseCreatorStore.getState().undoClip();
    const restored = usePoseCreatorStore.getState().clipDraft;
    expect(restored.keyframes[0]?.time).toBe(0.25);
    expect(restored.selectedKeyframeId).toBe(keyframeId);
    expect(restored.currentTimeSec).toBe(0.25);
    expect(selectCanRedoClip(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().redoClip();
    const redone = usePoseCreatorStore.getState().clipDraft;
    expect(redone.keyframes[0]?.time).toBe(1.25);
    expect(redone.selectedKeyframeId).toBe(keyframeId);
    expect(redone.currentTimeSec).toBe(1.25);
  });

  it("keeps core history through Save without undoing saved identity", () => {
    const store = usePoseCreatorStore.getState();
    store.hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "save-boundary",
        name: "Save boundary",
        duration: 1,
        poses: { first: { ref: "relaxedRest" } },
        poseKeyframes: [{ time: 0, pose: "first" }],
        events: [{ id: "sound", kind: "sfx", time: 0.2, cueId: "old" }],
      }),
    );
    usePoseCreatorStore.getState().selectClipEvent("sound");
    usePoseCreatorStore.getState().updateSelectedClipEvent({ cueId: "new" });
    usePoseCreatorStore.getState().markClipDocumentSaved("Saved Asset Name");

    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().undoClip();
    const undone = usePoseCreatorStore.getState().clipDraft;
    expect(undone.name).toBe("Saved Asset Name");
    expect(undone.events[0]).toMatchObject({ cueId: "old" });
    expect(undone.isDirty).toBe(true);

    usePoseCreatorStore.getState().redoClip();
    const redone = usePoseCreatorStore.getState().clipDraft;
    expect(redone.name).toBe("Saved Asset Name");
    expect(redone.events[0]).toMatchObject({ cueId: "new" });
    expect(redone.isDirty).toBe(false);
  });

  it("rebases both Pose history directions when a durable pose save is acknowledged", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    });
    const store = usePoseCreatorStore.getState();
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.25 });
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.75 });
    store.undoPose();

    const current = usePoseCreatorStore.getState();
    current.acknowledgePoseSave({
      sessionToken: current.poseSessionToken,
      submittedDraft: capturePoseCreatorSubmittedDraft(current),
      savedIdentity: {
        itemId: "saved",
        poseId: "pose-save-history",
        logicalKey: null,
        revision: "r1",
        name: current.draftName,
      },
    });

    expect(selectCanRedoPose(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().redoPose();
    expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
      0.75,
    );
    expect(usePoseCreatorStore.getState().isDirty).toBe(true);

    usePoseCreatorStore.getState().undoPose();
    expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
      0.25,
    );
    expect(usePoseCreatorStore.getState().isDirty).toBe(false);
  });

  it("keeps dirty inline-edit metadata stable during a continuous drag", () => {
    const store = usePoseCreatorStore.getState();
    store.beginClipInlinePoseEdit({
      alias: "first",
      keyframeId: null,
      originalPose: { humanoid: {} },
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "Inline first",
    });
    store.beginClipUndoGroup();
    const editBefore = usePoseCreatorStore.getState().clipInlineEdit;
    store.setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 1, y: 0, z: 0 },
    });
    const dirtyEdit = usePoseCreatorStore.getState().clipInlineEdit;
    expect(dirtyEdit).not.toBe(editBefore);
    expect(dirtyEdit?.isDirty).toBe(true);
    for (const x of [2, 3, 4]) {
      store.setBoneDraft("head", {
        baseQuaternion: [0, 0, 0, 1],
        rotationDegrees: { x, y: 0, z: 0 },
      });
      // Workspace subscribers must not rerender for unchanged edit metadata.
      expect(usePoseCreatorStore.getState().clipInlineEdit).toBe(dirtyEdit);
    }
    expect(usePoseCreatorStore.getState().inlinePoseUndoHistory).toHaveLength(
      0,
    );
    store.endClipUndoGroup();
    expect(usePoseCreatorStore.getState().inlinePoseUndoHistory).toHaveLength(
      1,
    );
    store.undoClip();
    expect(usePoseCreatorStore.getState().boneDrafts).toEqual({});
    expect(usePoseCreatorStore.getState().clipInlineEdit?.isDirty).toBe(false);
    store.redoClip();
    expect(
      usePoseCreatorStore.getState().boneDrafts.head?.rotationDegrees.x,
    ).toBe(4);
    expect(usePoseCreatorStore.getState().clipInlineEdit?.isDirty).toBe(true);
  });

  it("uses a temporary history while editing an inline Clip pose", () => {
    const store = usePoseCreatorStore.getState();
    store.hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "inline-edit",
        name: "Inline edit",
        duration: 1,
        poses: {
          first: { humanoid: { head: { rotation: [0, 0, 0, 1] } } },
        },
        poseKeyframes: [{ time: 0, pose: "first" }],
      }),
    );
    const originalPose = usePoseCreatorStore.getState().clipDraft.poses.first!;
    usePoseCreatorStore.getState().beginClipInlinePoseEdit({
      alias: "first",
      keyframeId: usePoseCreatorStore.getState().clipDraft.keyframes[0]!.id,
      originalPose,
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "Inline first",
    });
    usePoseCreatorStore.getState().setExpressionDraft("happy", {
      baseValue: 0,
      value: 1,
    });

    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().undoClip();
    expect(usePoseCreatorStore.getState().expressionDrafts).toEqual({});
    expect(selectCanRedoClip(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().redoClip();
    expect(usePoseCreatorStore.getState().expressionDrafts.happy?.value).toBe(
      1,
    );
    usePoseCreatorStore.getState().undoClip();

    usePoseCreatorStore.getState().setExpressionDraft("happy", {
      baseValue: 0,
      value: 0.75,
    });
    usePoseCreatorStore.getState().commitClipInlinePoseEdit(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "first",
        name: "First",
        expressions: { happy: 0.75 },
      }),
    );
    expect(usePoseCreatorStore.getState().clipInlineEdit).toBeNull();
    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(true);

    usePoseCreatorStore.getState().undoClip();
    expect(usePoseCreatorStore.getState().clipDraft.poses.first).toEqual(
      originalPose,
    );
    expect(selectCanRedoClip(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().redoClip();
    expect(usePoseCreatorStore.getState().clipDraft.poses.first).toMatchObject({
      expressions: { happy: 0.75 },
    });
  });

  it("excludes settings and clears histories at replacement boundaries", () => {
    const store = usePoseCreatorStore.getState();
    store.updateClipDraft({ loop: true });
    store.setDraftName("Excluded name");
    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(false);
    expect(selectCanUndoPose(usePoseCreatorStore.getState())).toBe(false);

    store.setBoneDraft("head", {
      baseQuaternion: [0, 0, 0, 1],
      rotationDegrees: { x: 10, y: 0, z: 0 },
    });
    store.setModelSource(model("replacement-safe"));
    expect(selectCanUndoPose(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore
      .getState()
      .setBasePose(POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID);
    expect(selectCanUndoPose(usePoseCreatorStore.getState())).toBe(false);

    usePoseCreatorStore.getState().addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "temporary",
        name: "Temporary",
        expressions: { happy: 0.5 },
      }),
      "temporary",
    );
    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(true);
    usePoseCreatorStore.getState().resetClipDraft();
    expect(selectCanUndoClip(usePoseCreatorStore.getState())).toBe(false);
    expect(selectCanRedoClip(usePoseCreatorStore.getState())).toBe(false);
  });
});

describe("timeline inspector selection", () => {
  beforeEach(() => {
    const store = usePoseCreatorStore.getState();
    store.resetWorkspace();
    store.hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "selection",
        name: "Selection",
        duration: 1.2,
        poses: { pose: { expressions: { happy: 0.5 } } },
        poseKeyframes: [
          { time: 0.25, pose: "pose" },
          { time: 0.9, pose: "pose" },
        ],
        events: [{ id: "sound", kind: "sfx", time: 0.6, cueId: "bell" }],
      }),
    );
  });

  it("switches the inspector between events and keyframes without editing content or history", () => {
    const store = usePoseCreatorStore.getState();
    const original = store.clipDraft;
    const keyframeId = original.keyframes[0]!.id;
    store.selectClipEvent("sound");
    expect(usePoseCreatorStore.getState().clipDraft).toMatchObject({
      selectedEventId: "sound",
      selectedKeyframeId: null,
      currentTimeSec: 0.6,
    });
    store.selectClipKeyframe(keyframeId);
    expect(usePoseCreatorStore.getState().clipDraft).toMatchObject({
      selectedEventId: null,
      selectedKeyframeId: keyframeId,
      currentTimeSec: 0.25,
    });
    store.selectClipEvent("sound");
    const state = usePoseCreatorStore.getState();
    expect(state.clipDraft).toMatchObject({
      selectedEventId: "sound",
      selectedKeyframeId: null,
      currentTimeSec: 0.6,
    });
    expect(state.clipPlaybackAbsoluteTimeSec).toBe(0.6);
    expect(state.clipPlaybackPlaying).toBe(false);
    expect(state.clipDraft.keyframes).toBe(original.keyframes);
    expect(state.clipDraft.events).toBe(original.events);
    expect(state.clipUndoHistory).toEqual([]);
  });

  it.each([null, "missing"])(
    "clearing selection with %s leaves the other selected item and time intact",
    (emptyId) => {
      const store = usePoseCreatorStore.getState();
      const keyframeId = store.clipDraft.keyframes[0]!.id;
      store.selectClipEvent("sound");
      store.selectClipKeyframe(emptyId);
      expect(usePoseCreatorStore.getState().clipDraft).toMatchObject({
        selectedEventId: "sound",
        selectedKeyframeId: null,
        currentTimeSec: 0.6,
      });
      store.selectClipEvent(emptyId);
      expect(usePoseCreatorStore.getState().clipDraft).toMatchObject({
        selectedEventId: null,
        selectedKeyframeId: null,
        currentTimeSec: 0.6,
      });
      store.selectClipKeyframe(keyframeId);
      store.selectClipEvent(emptyId);
      expect(usePoseCreatorStore.getState().clipDraft).toMatchObject({
        selectedEventId: null,
        selectedKeyframeId: keyframeId,
        currentTimeSec: 0.25,
      });
      store.selectClipKeyframe(emptyId);
      expect(usePoseCreatorStore.getState().clipDraft).toMatchObject({
        selectedEventId: null,
        selectedKeyframeId: null,
        currentTimeSec: 0.25,
      });
    },
  );

  it.each([-1, 1] as const)(
    "selects the stepped keyframe instead of leaving the effect inspector open (%s)",
    (direction) => {
      const store = usePoseCreatorStore.getState();
      store.selectClipEvent("sound");
      store.stepClipKeyframe(direction);
      const clip = usePoseCreatorStore.getState().clipDraft;
      const keyframe = clip.keyframes[direction === -1 ? 0 : 1]!;
      expect(clip.selectedKeyframeId).toBe(keyframe.id);
      expect(clip.selectedEventId).toBeNull();
      expect(clip.currentTimeSec).toBe(keyframe.time);
    },
  );
});

describe("clip base endpoints", () => {
  beforeEach(() => usePoseCreatorStore.getState().resetWorkspace());

  it("inserts/removes only base endpoints and keeps them aligned on duration/base edits", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipBaseEndpoint("start", true);
    store.setClipBaseEndpoint("end", true);
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([0, 2]);
    store.updateClipDraft({ duration: 3 });
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([0, 3]);
    store.updateClipDraft({ basePose: "standing" });
    const draft = usePoseCreatorStore.getState().clipDraft;
    expect(
      draft.keyframes.every(
        (frame) =>
          (draft.poses[frame.pose] as { ref: string }).ref === "standing",
      ),
    ).toBe(true);
    store.setClipBaseEndpoint("start", false);
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([3]);
    store.undoClip();
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([0, 3]);
  });

  it("preserves both endpoints when clearing and replacing the duration input", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipBaseEndpoint("start", true);
    store.setClipBaseEndpoint("end", true);
    store.updateClipDraft({ duration: Number("") });
    expect(usePoseCreatorStore.getState().clipDraft.duration).toBe(2);
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([0, 2]);
    store.updateClipDraft({ duration: 3 });
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([0, 3]);
  });

  it("does not conflate start and end toggles in a loaded zero-duration clip", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipBaseEndpoint("start", true);
    const draft = usePoseCreatorStore.getState().clipDraft;
    usePoseCreatorStore.setState({ clipDraft: { ...draft, duration: 0 } });
    store.setClipBaseEndpoint("end", false);
    expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual(
      draft.keyframes,
    );
    store.updateClipDraft({ duration: 3 });
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([0]);
  });

  it("keeps endpoint undo/redo aligned after excluded settings change", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipBaseEndpoint("end", true);
    store.setClipBaseEndpoint("end", false);
    store.updateClipDraft({ duration: 4 });
    store.undoClip();
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([4]);
    store.redoClip();
    expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual([]);
  });

  it("preserves moved base landmarks when toggling endpoints", () => {
    const store = usePoseCreatorStore.getState();
    store.setClipBaseEndpoint("end", true);
    const id = usePoseCreatorStore.getState().clipDraft.keyframes[0]!.id;
    store.moveClipKeyframe(id, 1);
    store.setClipBaseEndpoint("end", false);
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([1]);
    store.setClipBaseEndpoint("end", true);
    expect(
      usePoseCreatorStore
        .getState()
        .clipDraft.keyframes.map((frame) => frame.time),
    ).toEqual([1, 2]);
  });

  it("preserves an authored pose occupying an endpoint", () => {
    const store = usePoseCreatorStore.getState();
    const draft = usePoseCreatorStore.getState().clipDraft;
    usePoseCreatorStore.setState({
      clipDraft: {
        ...draft,
        poses: { authored: { expressions: { happy: 1 } } },
        keyframes: [{ id: "authored", time: 0, pose: "authored" }],
      },
    });
    store.setClipBaseEndpoint("start", true);
    store.setClipBaseEndpoint("start", false);
    expect(usePoseCreatorStore.getState().clipDraft.keyframes).toEqual([
      { id: "authored", time: 0, pose: "authored" },
    ]);
  });
});

describe("durable pose copy boundaries", () => {
  beforeEach(() => usePoseCreatorStore.getState().resetWorkspace());
  it("freezes base and parent values in one undoable insertion and survives no-base hydration", () => {
    const store = usePoseCreatorStore.getState();
    store.hydrateClipDocument(
      parseAnimaPoseClip({
        schema: "animaPoseClip/1.0",
        id: "copy",
        name: "Copy",
        duration: 2,
        basePose: "relaxedRest",
        poses: { rest: { ref: "relaxedRest" } },
        poseKeyframes: [
          { time: 0, pose: "rest" },
          { time: 2, pose: "rest" },
        ],
      }),
    );
    const before = usePoseCreatorStore.getState().clipDraft;
    const beforeClip = buildAnimaPoseClipFromPoseCreatorDraft(before)!;
    const pose = parseAnimaPose({
      schema: "animaPose/1.0",
      id: "child",
      name: "Child",
      parent: { ref: "relaxedRest" },
      expressions: { happy: 0.7 },
    });
    const alias = store.addPoseToClip(pose, "Child", { timeSec: 1 });
    const copied = usePoseCreatorStore.getState().clipDraft;
    expect(alias).not.toBeNull();
    expect(copied.basePose).toBe("");
    const clip = buildAnimaPoseClipFromPoseCreatorDraft(copied)!;
    for (const time of [0, 2]) {
      expect(sampleAnimaPoseClip(clip, time).sample).toEqual(
        sampleAnimaPoseClip(beforeClip, time, getResolvedAvatarPose).sample,
      );
    }
    for (const time of [0, 0.5, 1, 1.5, 2]) {
      expect(sampleAnimaPoseClip(clip, time, () => null)).toEqual(
        sampleAnimaPoseClip(clip, time, () => ({
          humanoid: {},
          expressions: { happy: 0 },
        })),
      );
    }
    const copiedHumanoid = sampleAnimaPoseClip(clip, 1).sample.humanoid!;
    for (const [bone, transform] of Object.entries(
      getResolvedAvatarPose("relaxedRest").humanoid!,
    )) {
      transform.rotation?.forEach((value, index) =>
        expect(
          copiedHumanoid[bone as keyof typeof copiedHumanoid]?.rotation?.[
            index
          ],
        ).toBeCloseTo(value, 12),
      );
    }
    expect(sampleAnimaPoseClip(clip, 1).sample.expressions).toEqual({
      happy: 0.7,
    });
    store.undoClip();
    expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe(
      before.basePose,
    );
    expect(usePoseCreatorStore.getState().clipDraft.poses).toEqual(
      before.poses,
    );
    store.redoClip();
    expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe("");
    store.hydrateClipDocument(clip);
    expect(usePoseCreatorStore.getState().clipDraft.basePose).toBe("");
    expect(
      buildAnimaPoseClipFromPoseCreatorDraft(
        usePoseCreatorStore.getState().clipDraft,
      ),
    ).toEqual(clip);
  });
  it("rejects unresolved inheritance without changing the clip or history", () => {
    const before = usePoseCreatorStore.getState();
    const alias = before.addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "bad",
        name: "Bad",
        parent: { ref: "missing" },
      }),
      "Bad",
      { atPlayhead: true },
    );
    expect(alias).toBeNull();
    expect(usePoseCreatorStore.getState().clipDraft).toBe(before.clipDraft);
    expect(usePoseCreatorStore.getState().clipUndoHistory).toBe(
      before.clipUndoHistory,
    );
  });
});
