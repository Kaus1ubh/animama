import { Euler, MathUtils, Quaternion } from "three";
import { convertPoseQuaternionBasis } from "@/lib/avatar/poses/poseRetargeting";
import {
  usePoseCreatorStore,
  type PoseCreatorBoneDraft,
} from "@/stores/pose-creator-store";
import {
  createBoneDraft,
  getPoseCreatorNormalizedBoneNode,
} from "./poseCreatorAuthoring";
import {
  adjustHandQuaternion,
  handPresetQuaternion,
  resolveHandBones,
  type HandAdjustment,
  type HandBone,
  type HandPreset,
  type HandTarget,
} from "@/lib/avatar/poses/anatomy/handPresets";

type Store = ReturnType<typeof usePoseCreatorStore.getState>;
type Capture = {
  bone: HandBone;
  quaternion: Quaternion;
  draft: PoseCreatorBoneDraft;
  originalDraft: PoseCreatorBoneDraft | null;
};
type Interaction = {
  state: Store;
  group: Store["undoGroup"];
  captures: Capture[];
  adjustment: HandAdjustment;
};
function sameSession(left: Store, right: Store) {
  return (
    left.poseSessionToken === right.poseSessionToken &&
    left.clipSessionToken === right.clipSessionToken &&
    left.activeAvatar === right.activeAvatar &&
    left.authoringMode === right.authoringMode &&
    left.basePose === right.basePose &&
    left.clipInlineEdit?.originalPose === right.clipInlineEdit?.originalPose &&
    left.clipInlineEdit?.alias === right.clipInlineEdit?.alias &&
    left.clipInlineEdit?.keyframeId === right.clipInlineEdit?.keyframeId
  );
}
function degrees(quaternion: Quaternion) {
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    x: MathUtils.radToDeg(euler.x),
    y: MathUtils.radToDeg(euler.y),
    z: MathUtils.radToDeg(euler.z),
  };
}
/** Own one live edit group. Dispose on unmount; end before target/selection changes. */
export function createHandInteractionController() {
  let interaction: Interaction | null = null;
  let ownWrite = false;
  let lastError: string | null = null;
  const end = () => {
    const current = interaction;
    interaction = null;
    if (!current) return;
    const state = usePoseCreatorStore.getState();
    // A late event must never close another interaction's replacement group.
    if (
      !state.undoGroup ||
      state.undoGroup.snapshot !== current.group?.snapshot ||
      state.undoGroup.kind !== current.group.kind
    )
      return;
    ownWrite = true;
    try {
      if (current.state.clipInlineEdit) state.endClipUndoGroup();
      else state.endPoseUndoGroup();
    } finally {
      ownWrite = false;
    }
  };
  const unsubscribe = usePoseCreatorStore.subscribe((state, previous) => {
    if (!interaction || ownWrite) return;
    if (
      !sameSession(interaction.state, state) ||
      state.loadStatus !== "ready" ||
      state.boneDrafts !== previous.boneDrafts ||
      state.undoGroup !== interaction.group ||
      state.historyRequestRevision !== previous.historyRequestRevision
    )
      end();
  });
  const capture = (target: HandTarget, ids?: string[]): Capture[] => {
    const state = usePoseCreatorStore.getState();
    if (
      !state.activeAvatar ||
      state.loadStatus !== "ready" ||
      (state.authoringMode !== "pose" && !state.clipInlineEdit)
    )
      throw new Error("Wait for the Avatar to load before editing hands.");
    return resolveHandBones(state.activeAvatar, target, ids).available.map(
      (bone) => {
        const node = getPoseCreatorNormalizedBoneNode(
          state.activeAvatar,
          bone.boneName,
        )!;
        const existing = state.boneDrafts[bone.boneName];
        const quaternion = existing
          ? new Quaternion().setFromEuler(
              new Euler(
                MathUtils.degToRad(existing.rotationDegrees.x),
                MathUtils.degToRad(existing.rotationDegrees.y),
                MathUtils.degToRad(existing.rotationDegrees.z),
                "XYZ",
              ),
            )
          : convertPoseQuaternionBasis(
              state.activeAvatar?.vrm,
              node.quaternion,
            );
        const draft = createBoneDraft(
          state.activeAvatar,
          bone.boneName,
          degrees(quaternion),
          state.boneDrafts[bone.boneName],
        )!;
        if (
          !quaternion.toArray().every(Number.isFinite) ||
          quaternion.lengthSq() < 1e-12
        )
          throw new Error(
            "Invalid hand rotation. The pose was left unchanged.",
          );
        if (existing) draft.rotationDegrees = { ...existing.rotationDegrees };
        return { bone, quaternion, draft, originalDraft: existing ?? null };
      },
    );
  };
  const apply = (
    captures: Capture[],
    calculate: (capture: Capture) => Quaternion,
    retainExplicit = false,
  ) => {
    const state = usePoseCreatorStore.getState();
    const prepared = captures.map((entry) => {
      const quaternion = calculate(entry);
      const node = getPoseCreatorNormalizedBoneNode(
        state.activeAvatar,
        entry.bone.boneName,
      );
      if (
        !node ||
        !quaternion.toArray().every(Number.isFinite) ||
        quaternion.lengthSq() < 1e-12
      )
        throw new Error("Hand bones changed. Start the adjustment again.");
      return {
        ...entry,
        node,
        quaternion,
        captureQuaternion: entry.quaternion,
        draft: {
          ...entry.draft,
          rotationDegrees:
            quaternion.angleTo(entry.quaternion) < 1e-7
              ? entry.draft.rotationDegrees
              : degrees(quaternion),
        },
      };
    });
    // A changed-to-base rotation is intentional content, unlike returning to
    // the captured start. Keep it explicit so clip inheritance cannot bend it.
    const updates = Object.fromEntries(
      prepared.map((entry) => [
        entry.bone.boneName,
        retainExplicit
          ? entry.draft
          : entry.quaternion.angleTo(entry.captureQuaternion) < 1e-7
            ? entry.originalDraft
            : entry.draft,
      ]),
    );
    ownWrite = true;
    try {
      if (!state.setBoneDraftBatch(updates))
        throw new Error("Invalid hand rotation. The pose was left unchanged.");
      for (const entry of prepared)
        entry.node.quaternion.copy(
          convertPoseQuaternionBasis(state.activeAvatar?.vrm, entry.quaternion),
        );
      state.activeAvatar?.vrm?.update(0);
    } finally {
      ownWrite = false;
    }
    return true;
  };
  const fail = (error: unknown) => {
    lastError =
      error instanceof Error ? error.message : "Unable to adjust hands.";
    end();
    return false;
  };
  return {
    get lastError() {
      return lastError;
    },
    begin(target: HandTarget, ids: string[], adjustment: HandAdjustment) {
      end();
      lastError = null;
      try {
        const captures = capture(target, ids).filter(
          (entry) => adjustment !== "spread" || entry.bone.segment.spread,
        );
        if (!captures.length)
          throw new Error("Select available finger bones for this adjustment.");
        const state = usePoseCreatorStore.getState();
        if (state.undoGroup)
          throw new Error(
            "Finish the current pose edit before adjusting hands.",
          );
        if (state.clipInlineEdit) state.beginClipUndoGroup();
        else state.beginPoseUndoGroup();
        interaction = {
          state,
          group: usePoseCreatorStore.getState().undoGroup,
          captures,
          adjustment,
        };
        return true;
      } catch (error) {
        return fail(error);
      }
    },
    update(value: number) {
      const current = interaction;
      if (
        !current ||
        !sameSession(current.state, usePoseCreatorStore.getState())
      )
        return false;
      try {
        return apply(current.captures, ({ bone, quaternion }) =>
          adjustHandQuaternion(
            quaternion,
            bone.side,
            bone.segment.digit,
            current.adjustment,
            value,
          ),
        );
      } catch (error) {
        return fail(error);
      }
    },
    end,
    preset(target: HandTarget, preset: HandPreset) {
      end();
      lastError = null;
      try {
        const captures = capture(target);
        if (!captures.length)
          throw new Error(
            "No finger bones are available on the selected hand.",
          );
        if (usePoseCreatorStore.getState().undoGroup)
          throw new Error(
            "Finish the current pose edit before applying a hand preset.",
          );
        // Presets explicitly replace all available finger channels, including
        // identity rotations needed to override a later clip's inherited base.
        return apply(
          captures,
          ({ bone }) =>
            handPresetQuaternion(
              bone,
              preset,
              usePoseCreatorStore.getState().activeAvatar,
            ),
          true,
        );
      } catch (error) {
        return fail(error);
      }
    },
    dispose() {
      end();
      unsubscribe();
    },
  };
}
