import {
  ANIMA_POSE_SCHEMA,
  parseAnimaPose,
  type AnimaPose,
  type AnimaPoseClipSample,
  type AnimaPoseClipSampleDiagnostics,
  type Avatar,
} from "@/lib/avatar";
import { POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID } from "@/stores/pose-creator-store";
import { applyPoseCreatorBasePose } from "./poseCreatorAuthoring";
import { samplePoseCreatorDraft } from "./poseCreatorClipMotion";
import {
  type PoseCreatorClipDraft,
  type PoseCreatorClipPreviewDiagnostics,
} from "./poseCreatorClipAuthoring";

type PoseCreatorClipPreviewResult = {
  applied: boolean;
  diagnostics: PoseCreatorClipPreviewDiagnostics;
};

/** A preview base supplies posture without adding humanoid data to the authored clip. */
export function applyPoseCreatorClipPreview(
  avatar: Avatar | null,
  draft: PoseCreatorClipDraft,
  previewBasePose?: string,
): PoseCreatorClipPreviewResult {
  if (!avatar) {
    return {
      applied: false,
      diagnostics: createPoseCreatorClipPreviewDiagnostics(),
    };
  }

  const result = samplePoseCreatorDraft(
    draft,
    draft.currentTimeSec,
    avatar.vrm ?? null,
    { omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID },
  );
  if (!result) {
    // An empty document still owns the canvas state. Restore it after a prior
    // preview's cleanup or a late Avatar mount instead of retaining old edits.
    applyPoseCreatorBasePose(avatar, previewBasePose ?? draft.basePose);
    avatar.clearAllExpressionOverrides();
    avatar.vrm?.update(0);
    return {
      applied: false,
      diagnostics: createPoseCreatorClipPreviewDiagnostics(),
    };
  }

  applyPoseCreatorBasePose(avatar, previewBasePose ?? draft.basePose);
  // Humanoid poses can be written directly, but facial values must go through
  // Avatar's expression controller. Direct VRM expression-manager writes are
  // overwritten by Avatar.update() on the next frame, which made a one-off
  // timeline seek disagree with the sampled values shown in the editor.
  avatar.applyAnimaPose(createPreviewPose(result.sample, draft.id, draft.name));
  applyPoseCreatorClipPreviewExpressions(avatar, result.sample.expressions);
  avatar.vrm?.update(0);

  return {
    applied: true,
    diagnostics: createPoseCreatorClipPreviewDiagnostics(result.diagnostics),
  };
}

/**
 * Pin one sampled facial state through Avatar's durable manual-expression path.
 * Clearing the previous sample prevents stale authored values while leaving
 * unspecified channels (such as natural blinking) under normal Avatar control.
 */
export function applyPoseCreatorClipPreviewExpressions(
  avatar: Avatar,
  expressions: Record<string, number> | undefined,
): void {
  avatar.clearAllExpressionOverrides();
  const available = new Set(avatar.getAvailableExpressions());
  for (const [expressionName, value] of Object.entries(expressions ?? {})) {
    if (available.has(expressionName)) {
      avatar.setExpression(expressionName, value);
    }
  }
}

/** Read the facial state represented by the current timeline playhead. */
export function samplePoseCreatorClipExpressions(
  draft: PoseCreatorClipDraft,
): Record<string, number> {
  return {
    ...(samplePoseCreatorDraft(draft, draft.currentTimeSec, null, {
      omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
    })?.sample.expressions ?? {}),
  };
}

export function createPoseCreatorClipPreviewDiagnostics(
  diagnostics?: AnimaPoseClipSampleDiagnostics,
  eventDiagnostics: Partial<
    Omit<PoseCreatorClipPreviewDiagnostics, "missingPoseRefs">
  > = {},
): PoseCreatorClipPreviewDiagnostics {
  return {
    missingPoseRefs: [...new Set(diagnostics?.missingPoseRefs ?? [])],
    missingAvatarVFXIds: [
      ...new Set(eventDiagnostics.missingAvatarVFXIds ?? []),
    ],
    missingSceneVFXPresetIds: [
      ...new Set(eventDiagnostics.missingSceneVFXPresetIds ?? []),
    ],
    missingParticleVFXIds: [
      ...new Set(eventDiagnostics.missingParticleVFXIds ?? []),
    ],
    missingSFXCueIds: [...new Set(eventDiagnostics.missingSFXCueIds ?? [])],
    eventAdapterWarnings: [
      ...new Set(eventDiagnostics.eventAdapterWarnings ?? []),
    ],
  };
}

function createPreviewPose(
  sample: AnimaPoseClipSample,
  clipId: string,
  clipName: string,
): AnimaPose {
  return parseAnimaPose({
    schema: ANIMA_POSE_SCHEMA,
    id: `${clipId}.preview`,
    name: `${clipName} Preview`,
    ...(sample.humanoid ? { humanoid: sample.humanoid } : {}),
  });
}
