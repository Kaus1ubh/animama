import {
  ANIMA_POSE_SCHEMA,
  getResolvedAvatarPose,
  parseAnimaPose,
  sampleAnimaPoseClip,
  type AnimaPose,
  type AnimaPoseClipPoseResolver,
  type AnimaPoseClipSample,
  type AnimaPoseClipSampleDiagnostics,
  type Avatar,
} from "@/lib/avatar";
import { POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID } from "@/stores/pose-creator-store";
import { applyPoseCreatorBasePose } from "./poseCreatorAuthoring";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  type PoseCreatorClipDraft,
  type PoseCreatorClipPreviewDiagnostics,
} from "./poseCreatorClipAuthoring";

type PoseCreatorClipPreviewResult = {
  applied: boolean;
  diagnostics: PoseCreatorClipPreviewDiagnostics;
};

export function applyPoseCreatorClipPreview(
  avatar: Avatar | null,
  draft: PoseCreatorClipDraft,
): PoseCreatorClipPreviewResult {
  if (!avatar) {
    return {
      applied: false,
      diagnostics: createPoseCreatorClipPreviewDiagnostics(),
    };
  }

  const clip = buildAnimaPoseClipFromPoseCreatorDraft(draft, {
    omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  });
  if (!clip) {
    return {
      applied: false,
      diagnostics: createPoseCreatorClipPreviewDiagnostics(),
    };
  }

  const result = sampleAnimaPoseClip(
    clip,
    draft.currentTimeSec,
    resolveCatalogPose,
  );
  applyPoseCreatorBasePose(avatar, draft.basePose);
  // Humanoid poses can be written directly, but facial values must go through
  // Avatar's expression controller. Direct VRM expression-manager writes are
  // overwritten by Avatar.update() on the next frame, which made a one-off
  // timeline seek disagree with the sampled values shown in the editor.
  avatar.applyAnimaPose(createPreviewPose(result.sample, clip.id, clip.name));
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
  const clip = buildAnimaPoseClipFromPoseCreatorDraft(draft, {
    omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  });
  if (!clip) return {};

  return {
    ...(sampleAnimaPoseClip(clip, draft.currentTimeSec, resolveCatalogPose)
      .sample.expressions ?? {}),
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

const resolveCatalogPose: AnimaPoseClipPoseResolver = (poseId) => {
  try {
    return getResolvedAvatarPose(poseId);
  } catch {
    return null;
  }
};

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
