import type { VRM } from "@pixiv/three-vrm";

import {
  deleteBeat,
  detachBasePose,
  insertBeat,
  retimeBeat,
  setBeatEase,
  setBeatLabel,
  setBeatPose,
  type BeatEditContext,
  type BeatPose,
} from "@/lib/avatar/poses/animaPoseClip/beatEditing";
import {
  createAnimaPoseClipProgram,
  type AnimaPoseClipProgram,
} from "@/lib/avatar/poses/animaPoseClip/program";
import type { AnimaPoseClipSampleResult } from "@/lib/avatar/poses/animaPoseClip/schema";
import type {
  AnimaPoseClipEase,
  AnimaPoseClipV2,
} from "@/lib/avatar/poses/animaPoseClip/schemaV2";

import { isAnimaPoseClipV2 } from "@/lib/avatar/poses/animaPoseClip/anyClip";
import { sampleAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip/sampling";

import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  clampPoseCreatorClipTime,
  hasPoseCreatorClipValidationErrors,
  isPoseCreatorBaseKeyframe,
  motionFromClip,
  POSE_CREATOR_BASE_BEAT_LABEL,
  poseCreatorMotionClip,
  poseCreatorMotionKeyframes,
  resolvePoseCreatorCatalogPose,
  withPoseCreatorClipValidation,
  type PoseCreatorClipDraft,
  type PoseCreatorClipKeyframeDraft,
  type PoseCreatorClipValidationOptions,
} from "./poseCreatorClipAuthoring";

/**
 * Creator drafts of `animaPoseClip/2.0` clips. The draft keeps the clip's
 * beats and tracks as `motion`, its source of truth; the timeline's keyframes
 * are a view of the beats (keyframe id = beat id), rebuilt after every edit.
 * Edits go through the beat operations, so a beat's generated detail follows
 * it. New drafts start with empty motion and 1.0 clips open converted.
 */

/**
 * Replace a draft's motion with a clip's, rebuilding the keyframe view and
 * keeping the selection when its beat still exists.
 */
export function withPoseCreatorMotion(
  draft: PoseCreatorClipDraft,
  clip: AnimaPoseClipV2,
  options: PoseCreatorClipValidationOptions & {
    selectedKeyframeId?: string | null;
    currentTimeSec?: number;
    dirty?: boolean;
  } = {},
): PoseCreatorClipDraft {
  const motion = motionFromClip(clip);
  const keyframes = poseCreatorMotionKeyframes(clip);
  const requested =
    options.selectedKeyframeId === undefined
      ? draft.selectedKeyframeId
      : options.selectedKeyframeId;
  const selectedKeyframeId = keyframes.some(({ id }) => id === requested)
    ? requested
    : null;
  // Selecting a beat ends an effect selection, as on the timeline.
  const selectedEventId =
    options.selectedKeyframeId && selectedKeyframeId
      ? null
      : draft.selectedEventId;
  return withPoseCreatorClipValidation(
    {
      ...draft,
      motion,
      // Beats own their poses; the view needs only an entry per keyframe.
      poses: Object.fromEntries(keyframes.map(({ pose }) => [pose, {}])),
      keyframes,
      selectedKeyframeId,
      selectedPoseAlias: selectedKeyframeId,
      selectedEventId,
      currentTimeSec: clampPoseCreatorClipTime(
        options.currentTimeSec ?? draft.currentTimeSec,
        draft.duration,
      ),
      isDirty: options.dirty ?? true,
    },
    options,
  );
}

export function poseCreatorBeatContext(vrm: VRM | null): BeatEditContext {
  return { vrm, resolvePose: resolvePoseCreatorCatalogPose };
}

type MotionEdit = (
  clip: AnimaPoseClipV2,
  context: BeatEditContext,
) => {
  clip: AnimaPoseClipV2;
  selectedKeyframeId?: string | null;
  time?: number;
};

function editMotion(
  draft: PoseCreatorClipDraft,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions,
  edit: MotionEdit,
): PoseCreatorClipDraft {
  if (!draft.motion) return draft;
  const result = edit(
    poseCreatorMotionClip(draft, draft.motion, options),
    poseCreatorBeatContext(vrm),
  );
  return withPoseCreatorMotion(draft, result.clip, {
    ...options,
    selectedKeyframeId: result.selectedKeyframeId,
    currentTimeSec: result.time,
  });
}

export function retimePoseCreatorBeat(
  draft: PoseCreatorClipDraft,
  beatId: string,
  timeSec: number,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return editMotion(draft, null, options, (clip) => {
    const next = retimeBeat(clip, beatId, timeSec);
    const time = next.beats.find(({ id }) => id === beatId)?.time;
    return { clip: next, selectedKeyframeId: beatId, time };
  });
}

export function deletePoseCreatorBeat(
  draft: PoseCreatorClipDraft,
  beatId: string,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return editMotion(draft, null, options, (clip) => {
    const index = clip.beats.findIndex(({ id }) => id === beatId);
    const next = deleteBeat(clip, beatId);
    const neighbour = next.beats[Math.min(index, next.beats.length - 1)];
    return { clip: next, selectedKeyframeId: neighbour?.id ?? null };
  });
}

export function setPoseCreatorBeatEase(
  draft: PoseCreatorClipDraft,
  beatId: string,
  ease: AnimaPoseClipEase | undefined,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return editMotion(draft, null, options, (clip) => ({
    clip: setBeatEase(clip, beatId, ease),
  }));
}

export function setPoseCreatorBeatLabel(
  draft: PoseCreatorClipDraft,
  beatId: string,
  label: string,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return editMotion(draft, null, options, (clip) => ({
    clip: setBeatLabel(clip, beatId, label),
  }));
}

/**
 * Add a beat at a time (or select the one already there), optionally with a
 * pose: a captured pose keeps the motion; a Library Pose replaces it there.
 */
export function insertPoseCreatorBeat(
  draft: PoseCreatorClipDraft,
  request: { timeSec: number; label: string; pose?: BeatPose },
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return editMotion(draft, vrm, options, (clip, context) => {
    const inserted = insertBeat(clip, request, context);
    const next = request.pose
      ? setBeatPose(inserted.clip, inserted.beatId, request.pose, context)
      : inserted.clip;
    const time = next.beats.find(({ id }) => id === inserted.beatId)?.time;
    return { clip: next, selectedKeyframeId: inserted.beatId, time };
  });
}

/**
 * Insert a Library Pose by value as one edit: the beat takes the pose (its
 * omitted bones at the base pose), then the base pose is frozen into the
 * tracks and its reference removed, so the clip no longer depends on the
 * catalog. Null when the base pose does not resolve.
 */
export function insertPoseCreatorLibraryPose(
  draft: PoseCreatorClipDraft,
  request: { timeSec: number; label: string; pose: BeatPose },
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft | null {
  let detached = true;
  const inserted = editMotion(draft, vrm, options, (clip, context) => {
    const { clip: withBeat, beatId } = insertBeat(clip, request, context);
    const posed = setBeatPose(withBeat, beatId, request.pose, context);
    const next = detachBasePose(posed, context);
    if (!next) detached = false;
    const time = posed.beats.find(({ id }) => id === beatId)?.time;
    return { clip: next ?? posed, selectedKeyframeId: beatId, time };
  });
  return detached
    ? withPoseCreatorClipValidation({ ...inserted, basePose: "" }, options)
    : null;
}

/** Apply an edited key pose (Pose tab or Hands tool) to a beat. */
export function setPoseCreatorBeatPose(
  draft: PoseCreatorClipDraft,
  beatId: string,
  pose: BeatPose,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return editMotion(draft, vrm, options, (clip, context) => ({
    clip: setBeatPose(clip, beatId, pose, context),
    selectedKeyframeId: beatId,
  }));
}

/** Reaction expressions at the playhead: a beat there takes exactly these. */
export function setPoseCreatorBeatExpressionsAtTime(
  draft: PoseCreatorClipDraft,
  expressions: Record<string, number>,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return insertPoseCreatorBeat(
    draft,
    {
      timeSec: draft.currentTimeSec,
      label: "Expression",
      pose: { expressions },
    },
    vrm,
    options,
  );
}

/** The beat at a clip end that holds the base pose, if any. */
export function findPoseCreatorBaseBeat(
  draft: PoseCreatorClipDraft,
  endpoint: "start" | "end",
): PoseCreatorClipKeyframeDraft | null {
  // A zero-duration clip has no end distinct from its start.
  if (!draft.motion || (endpoint === "end" && draft.duration <= 0)) return null;
  return (
    draft.keyframes.find(
      (frame) =>
        isPoseCreatorBaseKeyframe(draft, frame) &&
        isAtPoseCreatorEndpoint(draft, frame, endpoint),
    ) ?? null
  );
}

function isAtPoseCreatorEndpoint(
  draft: PoseCreatorClipDraft,
  frame: PoseCreatorClipKeyframeDraft,
  endpoint: "start" | "end",
): boolean {
  const time = endpoint === "start" ? 0 : draft.duration;
  return Math.abs(frame.time - time) < 0.0005;
}

/** The base pose as a whole key pose for a Base beat. */
function basePoseForBeat(draft: PoseCreatorClipDraft): BeatPose {
  const base = draft.basePose
    ? resolvePoseCreatorCatalogPose(draft.basePose)
    : null;
  return { humanoid: base?.humanoid ?? {}, complete: true };
}

/** Add or remove a beat holding the base pose at the clip's start or end. */
export function setPoseCreatorBaseBeat(
  draft: PoseCreatorClipDraft,
  endpoint: "start" | "end",
  enabled: boolean,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  const existing = findPoseCreatorBaseBeat(draft, endpoint);
  if (!enabled)
    return existing
      ? deletePoseCreatorBeat(draft, existing.id, options)
      : draft;
  // A beat the author placed at the endpoint keeps its pose.
  if (
    existing ||
    (endpoint === "end" && draft.duration <= 0) ||
    draft.keyframes.some((frame) =>
      isAtPoseCreatorEndpoint(draft, frame, endpoint),
    )
  )
    return draft;
  return editMotion(draft, vrm, options, (clip, context) => {
    const inserted = insertBeat(
      clip,
      {
        timeSec: endpoint === "start" ? 0 : clip.duration,
        label: POSE_CREATOR_BASE_BEAT_LABEL,
      },
      context,
    );
    const labelled = setBeatLabel(
      inserted.clip,
      inserted.beatId,
      POSE_CREATOR_BASE_BEAT_LABEL,
    );
    const next = setBeatPose(
      labelled,
      inserted.beatId,
      basePoseForBeat(draft),
      context,
    );
    return { clip: next, selectedKeyframeId: inserted.beatId };
  });
}

/**
 * Re-pose the Base beats at the clip's ends with the draft's base pose,
 * after it changed. Their keys hold values, so they would otherwise keep
 * the previous base pose.
 */
export function reposePoseCreatorBaseBeats(
  draft: PoseCreatorClipDraft,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  const beatIds = (["start", "end"] as const).flatMap(
    (endpoint) => findPoseCreatorBaseBeat(draft, endpoint)?.id ?? [],
  );
  if (!beatIds.length) return draft;
  return editMotion(draft, vrm, options, (clip, context) => ({
    clip: beatIds.reduce(
      (next, beatId) =>
        setBeatPose(next, beatId, basePoseForBeat(draft), context),
      clip,
    ),
  }));
}

// ── Sampling ─────────────────────────────────────────────────────────────

/**
 * The draft's pose at a time: 2.0 drafts sample their prepared clip with the
 * creator Avatar; other drafts sample their 1.0 keyframes. Null when the
 * draft does not build.
 */
export function samplePoseCreatorDraft(
  draft: PoseCreatorClipDraft,
  timeSec: number,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): AnimaPoseClipSampleResult | null {
  if (draft.motion) {
    // Edits keep validation current; playback must not re-validate per frame.
    if (hasPoseCreatorClipValidationErrors(draft.validationIssues)) return null;
    return samplePoseCreatorMotion(draft, timeSec, vrm, options);
  }
  const clip = buildAnimaPoseClipFromPoseCreatorDraft(draft, options);
  return clip && !isAnimaPoseClipV2(clip)
    ? sampleAnimaPoseClip(clip, timeSec, resolvePoseCreatorCatalogPose)
    : null;
}

/** Prepared programs per motion, one per Avatar (null: no Avatar). */
const programs = new WeakMap<
  object,
  Map<VRM | null, { key: string; program: AnimaPoseClipProgram }>
>();

/**
 * Sample the draft's 2.0 clip at a time with the creator Avatar (fitted
 * hands, solved legs). Preparation is reused while the motion and clip
 * settings stay the same, separately for each Avatar the callers pass.
 */
export function samplePoseCreatorMotion(
  draft: PoseCreatorClipDraft,
  timeSec: number,
  vrm: VRM | null,
  options: PoseCreatorClipValidationOptions = {},
): AnimaPoseClipSampleResult | null {
  if (!draft.motion) return null;
  const key = JSON.stringify([
    draft.duration,
    draft.loop,
    draft.basePose,
    options.omittedBasePoseId ?? null,
  ]);
  let byAvatar = programs.get(draft.motion);
  if (!byAvatar) {
    byAvatar = new Map();
    programs.set(draft.motion, byAvatar);
  }
  let cached = byAvatar.get(vrm);
  if (!cached || cached.key !== key) {
    cached = {
      key,
      program: createAnimaPoseClipProgram(
        poseCreatorMotionClip(draft, draft.motion, options),
        { vrm, resolvePose: resolvePoseCreatorCatalogPose },
      ),
    };
    byAvatar.set(vrm, cached);
  }
  return cached.program.sample(timeSec);
}
