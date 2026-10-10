import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { getI18n } from "react-i18next";
import { Euler, MathUtils, Quaternion } from "three";
import {
  apiErrorLine,
  uncodedErrorText,
  WordedError,
} from "@/lib/errors/apiError";
import { convertPoseQuaternionBasis } from "@/lib/avatar/poses/poseRetargeting";
import type { QuaternionTuple } from "@/lib/avatar/poses/animaPoseClip/clipVocabulary";
import {
  POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  usePoseCreatorStore,
  type PoseCreatorBoneDraft,
} from "@/stores/pose-creator-store";
import {
  createBoneDraft,
  getPoseCreatorNormalizedBoneNode,
} from "./poseCreatorAuthoring";
import { poseCreatorBeatHandShape } from "./poseCreatorClipMotion";
import { adjustHandShape } from "@/lib/avatar/poses/anatomy/handOffsets";
import {
  adjustHandQuaternion,
  handPresetQuaternion,
  handShapeRotations,
  resolveHandBones,
  type HandAdjustment,
  type HandBone,
  type HandPreset,
  type HandShape,
  type HandSide,
  type HandTarget,
} from "@/lib/avatar/poses/anatomy/handPresets";

type Store = ReturnType<typeof usePoseCreatorStore.getState>;

/** Hands-tool refusals, worded in the UI Locale. */
type HandRefusal =
  | "waitForAvatar"
  | "invalidRotation"
  | "bonesChanged"
  | "selectAvailable"
  | "finishEditAdjust"
  | "noFingerBones"
  | "finishEditPreset";
function handError(refusal: HandRefusal): WordedError {
  const t = getI18n().getFixedT(null, "pose");
  switch (refusal) {
    case "waitForAvatar":
      return new WordedError(t("hands.errors.waitForAvatar"));
    case "invalidRotation":
      return new WordedError(t("hands.errors.invalidRotation"));
    case "bonesChanged":
      return new WordedError(t("hands.errors.bonesChanged"));
    case "selectAvailable":
      return new WordedError(t("hands.errors.selectAvailable"));
    case "finishEditAdjust":
      return new WordedError(t("hands.errors.finishEditAdjust"));
    case "noFingerBones":
      return new WordedError(t("hands.errors.noFingerBones"));
    case "finishEditPreset":
      return new WordedError(t("hands.errors.finishEditPreset"));
  }
}
type Capture = {
  bone: HandBone;
  quaternion: Quaternion;
  draft: PoseCreatorBoneDraft;
  originalDraft: PoseCreatorBoneDraft | null;
};
/**
 * A hand edited as a hand shape while a clip beat is edited: a Curl or
 * Spread changes the shape (the beat's hand key on commit) and the selected
 * fingers it drives show what that shape plays.
 */
type ShapeEdit = {
  side: HandSide;
  /** The side's shape recorded before this interaction, if any. */
  previous: HandShape | null;
  /** The shape the adjustment starts from. */
  start: HandShape;
  /** The selected bones the adjustment reaches, or the whole hand. */
  reach: HandBone[] | "hand";
  /** Selected bones the shape drives; they show what it plays. */
  shaped: Capture[];
};
type Interaction = {
  state: Store;
  group: Store["undoGroup"];
  /**
   * Bones turned directly: in Pose editing, on hands without hand keys, and
   * selected bones a hand shape does not drive (own tracks, or a pose offsets
   * cannot express).
   */
  captures: Capture[];
  shapes: ShapeEdit[];
  adjustment: HandAdjustment;
};
type Placement = { capture: Capture; quaternion: Quaternion };
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
/** A bone's canonical rotation as the editor shows it: its draft, else the Avatar's. */
function shownRotation(state: Store, boneName: string): Quaternion | null {
  const draft = state.boneDrafts[boneName];
  if (draft)
    return new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(draft.rotationDegrees.x),
        MathUtils.degToRad(draft.rotationDegrees.y),
        MathUtils.degToRad(draft.rotationDegrees.z),
        "XYZ",
      ),
    );
  const node = getPoseCreatorNormalizedBoneNode(state.activeAvatar, boneName);
  return node
    ? convertPoseQuaternionBasis(state.activeAvatar?.vrm, node.quaternion)
    : null;
}
/** The finger rotations a hand shape plays, fitted around the shown metacarpal. */
function shapeRotations(state: Store, side: HandSide, shape: HandShape) {
  return handShapeRotations(
    state.activeAvatar?.vrm ?? null,
    side,
    shape,
    shownRotation(state, `${side}ThumbMetacarpal`)?.toArray() as
      | QuaternionTuple
      | undefined,
  );
}
/**
 * The hand shape a Curl or Spread adjusts while a clip beat is edited, and
 * the bones it does not drive: the shape chosen earlier in this edit, else
 * the beat's hand key read from the clip, its offsets fitted to the hand as
 * shown (so earlier bone edits are kept). Null outside a clip beat, or when
 * nothing is recorded and the hand has no hand keys; the adjustment then
 * turns bones as in a Pose.
 */
function startShape(
  state: Store,
  side: HandSide,
  captures: readonly Capture[],
) {
  const edit = state.clipInlineEdit;
  if (!edit?.keyframeId) return null;
  // The beat's pose when the edit began: bone edits are judged against it.
  const original = new Map<VRMHumanBoneName, Quaternion>();
  for (const { bone } of captures) {
    const rotation =
      edit.originalPose.humanoid?.[bone.boneName as VRMHumanBoneName]?.rotation;
    if (rotation)
      original.set(
        bone.boneName as VRMHumanBoneName,
        new Quaternion(...rotation),
      );
  }
  return poseCreatorBeatHandShape(
    state.clipDraft,
    edit.keyframeId,
    side,
    new Map(
      captures.map(({ bone, quaternion }) => [
        bone.boneName as VRMHumanBoneName,
        quaternion,
      ]),
    ),
    original,
    shownRotation(state, `${side}ThumbMetacarpal`)?.toArray() as
      | QuaternionTuple
      | undefined,
    edit.handShapes?.[side] ?? null,
    state.activeAvatar?.vrm ?? null,
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
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
      throw handError("waitForAvatar");
    return resolveHandBones(state.activeAvatar, target, ids).available.map(
      (bone) => {
        const existing = state.boneDrafts[bone.boneName];
        // Available bones have a node, so the shown rotation always exists.
        const quaternion = shownRotation(state, bone.boneName)!;
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
          throw handError("invalidRotation");
        if (existing) draft.rotationDegrees = { ...existing.rotationDegrees };
        return { bone, quaternion, draft, originalDraft: existing ?? null };
      },
    );
  };
  /**
   * Show new rotations for captured bones as one draft edit; `handShapes`
   * records (or clears) a side's hand shape in the same history step.
   */
  const apply = (
    placements: Placement[],
    retainExplicit = false,
    handShapes?: Partial<Record<HandSide, HandShape | null>>,
  ) => {
    const state = usePoseCreatorStore.getState();
    const prepared = placements.map(({ capture: entry, quaternion }) => {
      const node = getPoseCreatorNormalizedBoneNode(
        state.activeAvatar,
        entry.bone.boneName,
      );
      if (
        !node ||
        !quaternion.toArray().every(Number.isFinite) ||
        quaternion.lengthSq() < 1e-12
      )
        throw handError("bonesChanged");
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
      if (!state.setBoneDraftBatch(updates, handShapes))
        throw handError("invalidRotation");
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
  // Refusals arrive worded; other English (such as an anatomy error) stays
  // primary in English and is detail under a worded message elsewhere.
  const fail = (error: unknown) => {
    const t = getI18n().getFixedT(null, "pose");
    lastError =
      error instanceof WordedError
        ? error.message
        : apiErrorLine(
            uncodedErrorText(
              error instanceof Error ? error.message : null,
              t("hands.errors.adjustFailed"),
            ),
          );
    end();
    return false;
  };
  const sidesOf = (target: HandTarget): HandSide[] =>
    target === "both" ? ["left", "right"] : [target];
  return {
    get lastError() {
      return lastError;
    },
    begin(target: HandTarget, ids: string[], adjustment: HandAdjustment) {
      end();
      lastError = null;
      try {
        const eligible = (entry: Capture) =>
          adjustment !== "spread" || entry.bone.segment.spread;
        const selected = capture(target, ids).filter(eligible);
        if (!selected.length) throw handError("selectAvailable");
        const state = usePoseCreatorStore.getState();
        if (state.undoGroup) throw handError("finishEditAdjust");
        // At a clip beat, a hand with a shape (recorded, or its hand keys)
        // keeps it: the adjustment changes the shape instead of turning the
        // bones the shape drives. Only selected bones move.
        const shapes: ShapeEdit[] = [];
        for (const side of sidesOf(target)) {
          const chosen = selected.filter((entry) => entry.bone.side === side);
          if (!chosen.length) continue;
          const captures = capture(side);
          const start = startShape(state, side, captures);
          if (!start) continue;
          const shaped = chosen.filter(
            (entry) =>
              !start.unshaped.has(entry.bone.boneName as VRMHumanBoneName),
          );
          shapes.push({
            side,
            previous: state.clipInlineEdit?.handShapes?.[side] ?? null,
            start: start.shape,
            reach:
              chosen.length === captures.filter(eligible).length
                ? "hand"
                : shaped.map((entry) => entry.bone),
            shaped,
          });
        }
        const shaped = new Set(
          shapes.flatMap((edit) => edit.shaped.map((entry) => entry.bone)),
        );
        if (state.clipInlineEdit) state.beginClipUndoGroup();
        else state.beginPoseUndoGroup();
        interaction = {
          state,
          group: usePoseCreatorStore.getState().undoGroup,
          captures: selected.filter((entry) => !shaped.has(entry.bone)),
          shapes,
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
        const placements: Placement[] = current.captures.map((entry) => ({
          capture: entry,
          quaternion: adjustHandQuaternion(
            entry.quaternion,
            entry.bone.side,
            entry.bone.segment.digit,
            current.adjustment,
            value,
          ),
        }));
        const handShapes: Partial<Record<HandSide, HandShape | null>> = {};
        for (const edit of current.shapes) {
          // Zero returns to where the interaction started, shape included.
          const shape =
            value === 0
              ? null
              : adjustHandShape(
                  edit.start,
                  edit.side,
                  current.adjustment,
                  value,
                  edit.reach,
                );
          const rotations = shape
            ? shapeRotations(usePoseCreatorStore.getState(), edit.side, shape)
            : null;
          for (const entry of edit.shaped)
            placements.push({
              capture: entry,
              quaternion:
                rotations?.get(entry.bone.boneName as VRMHumanBoneName) ??
                entry.quaternion,
            });
          // A shape the adjustment left as it was is not a new choice.
          handShapes[edit.side] =
            shape && JSON.stringify(shape) !== JSON.stringify(edit.start)
              ? shape
              : edit.previous;
        }
        return apply(placements, false, handShapes);
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
        if (!captures.length) throw handError("noFingerBones");
        const state = usePoseCreatorStore.getState();
        if (state.undoGroup) throw handError("finishEditPreset");
        // Presets explicitly replace all available finger channels, including
        // identity rotations needed to override a later clip's inherited base.
        if (!state.clipInlineEdit?.keyframeId)
          return apply(
            captures.map((entry) => ({
              capture: entry,
              quaternion: handPresetQuaternion(
                entry.bone,
                preset,
                state.activeAvatar,
              ),
            })),
            true,
          );
        // At a clip beat the preset becomes the beat's hand key; the fingers
        // show exactly what that key plays.
        const handShapes: Partial<Record<HandSide, HandShape>> = {};
        const placements: Placement[] = [];
        for (const side of sidesOf(target)) {
          const sideCaptures = captures.filter(
            (entry) => entry.bone.side === side,
          );
          if (!sideCaptures.length) continue;
          const shape: HandShape = { preset };
          const rotations = shapeRotations(state, side, shape);
          for (const entry of sideCaptures)
            placements.push({
              capture: entry,
              quaternion:
                rotations.get(entry.bone.boneName as VRMHumanBoneName) ??
                handPresetQuaternion(entry.bone, preset, state.activeAvatar),
            });
          handShapes[side] = shape;
        }
        return apply(placements, true, handShapes);
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
