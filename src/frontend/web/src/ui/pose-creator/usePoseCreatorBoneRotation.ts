import { useCallback } from "react";

import type {
  PoseCreatorBoneDraft,
  PoseCreatorQuaternionTuple,
  PoseCreatorRotationDegrees,
} from "@/stores/pose-creator-store";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  applyBoneDraft,
  createBoneDraft,
  getPoseCreatorMirrorBoneName,
  isBoneDraftAtBase,
  mirrorPoseCreatorRotationDegrees,
  restoreBoneBaseQuaternion,
} from "./poseCreatorAuthoring";

export type PoseCreatorBoneRotationUpdateOptions = {
  /** Stable inherited rotation captured before an on-canvas drag mutates the bone. */
  baseQuaternion?: PoseCreatorQuaternionTuple | null;
};

/**
 * Owns selected-bone mutations shared by numerical controls and the 3D gizmo.
 * Keeping mirroring and draft cleanup here prevents the two input surfaces from
 * producing different saved poses.
 */
export function usePoseCreatorBoneRotation() {
  const mirrorOppositeBone = usePoseCreatorStore(
    (state) => state.mirrorOppositeBone,
  );

  const runWithUndoGroup = useCallback(<T>(mutation: () => T): T => {
    const state = usePoseCreatorStore.getState();
    const inlinePose = Boolean(state.clipInlineEdit);
    if (inlinePose) state.beginClipUndoGroup();
    else state.beginPoseUndoGroup();
    try {
      return mutation();
    } finally {
      const current = usePoseCreatorStore.getState();
      if (inlinePose) current.endClipUndoGroup();
      else current.endPoseUndoGroup();
    }
  }, []);

  const applyMirroredBoneDraft = useCallback(
    (sourceDraft: PoseCreatorBoneDraft, mirrorEnabled?: boolean) => {
      const state = usePoseCreatorStore.getState();
      const enabled = mirrorEnabled ?? state.mirrorOppositeBone;
      const avatar = state.activeAvatar;
      const sourceBoneName = state.selectedBone;
      if (!enabled || !avatar || !sourceBoneName) return;

      const mirroredBoneName = getPoseCreatorMirrorBoneName(sourceBoneName);
      if (
        !mirroredBoneName ||
        !avatar.vrm?.humanoid.getNormalizedBoneNode(mirroredBoneName)
      ) {
        return;
      }

      const existingDraft = state.boneDrafts[mirroredBoneName] ?? null;
      const mirroredDraft = createBoneDraft(
        avatar,
        mirroredBoneName,
        mirrorPoseCreatorRotationDegrees(sourceDraft.rotationDegrees),
        existingDraft,
      );
      if (!mirroredDraft) return;

      if (isBoneDraftAtBase(mirroredDraft)) {
        restoreBoneBaseQuaternion(avatar, mirroredBoneName, mirroredDraft);
        state.removeBoneDraft(mirroredBoneName);
        return;
      }

      if (!applyBoneDraft(avatar, mirroredBoneName, mirroredDraft)) return;
      state.setBoneDraft(mirroredBoneName, mirroredDraft);
    },
    [],
  );

  const resetMirroredBone = useCallback(() => {
    const state = usePoseCreatorStore.getState();
    const avatar = state.activeAvatar;
    const sourceBoneName = state.selectedBone;
    if (!state.mirrorOppositeBone || !avatar || !sourceBoneName) return;

    const mirroredBoneName = getPoseCreatorMirrorBoneName(sourceBoneName);
    if (!mirroredBoneName) return;
    const mirroredDraft = state.boneDrafts[mirroredBoneName] ?? null;
    if (!mirroredDraft) return;

    restoreBoneBaseQuaternion(avatar, mirroredBoneName, mirroredDraft);
    state.removeBoneDraft(mirroredBoneName);
  }, []);

  const updateSelectedBoneRotation = useCallback(
    (
      nextRotationDegrees: PoseCreatorRotationDegrees,
      options: PoseCreatorBoneRotationUpdateOptions = {},
    ): boolean => {
      const state = usePoseCreatorStore.getState();
      const avatar = state.activeAvatar;
      const boneName = state.selectedBone;
      if (!avatar || !boneName) return false;

      const previousDraft = state.boneDrafts[boneName] ?? null;
      const nextDraft = createBoneDraft(
        avatar,
        boneName,
        nextRotationDegrees,
        previousDraft,
        options.baseQuaternion,
      );
      if (!nextDraft) return false;
      return runWithUndoGroup(() => {
        if (isBoneDraftAtBase(nextDraft)) {
          restoreBoneBaseQuaternion(avatar, boneName, nextDraft);
          state.removeBoneDraft(boneName);
          resetMirroredBone();
          return true;
        }

        if (!applyBoneDraft(avatar, boneName, nextDraft)) return false;
        state.setBoneDraft(boneName, nextDraft);
        applyMirroredBoneDraft(nextDraft);
        return true;
      });
    },
    [applyMirroredBoneDraft, resetMirroredBone, runWithUndoGroup],
  );

  const resetSelectedBoneRotation = useCallback((): boolean => {
    const state = usePoseCreatorStore.getState();
    const avatar = state.activeAvatar;
    const boneName = state.selectedBone;
    const draft = boneName ? state.boneDrafts[boneName] : null;
    if (!avatar || !boneName || !draft) return false;

    return runWithUndoGroup(() => {
      restoreBoneBaseQuaternion(avatar, boneName, draft);
      state.removeBoneDraft(boneName);
      resetMirroredBone();
      return true;
    });
  }, [resetMirroredBone, runWithUndoGroup]);

  const setMirrorOppositeBoneEnabled = useCallback(
    (enabled: boolean) => {
      const state = usePoseCreatorStore.getState();
      state.setMirrorOppositeBone(enabled);
      if (!enabled || !state.selectedBone) return;

      const selectedDraft = state.boneDrafts[state.selectedBone] ?? null;
      if (selectedDraft) {
        runWithUndoGroup(() => applyMirroredBoneDraft(selectedDraft, true));
      }
    },
    [applyMirroredBoneDraft, runWithUndoGroup],
  );

  return {
    mirrorOppositeBone,
    resetSelectedBoneRotation,
    setMirrorOppositeBoneEnabled,
    updateSelectedBoneRotation,
  };
}
