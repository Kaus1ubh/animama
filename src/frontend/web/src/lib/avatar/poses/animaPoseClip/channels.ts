import {
  isAnimaPoseClipRef,
  parseAnimaPoseClip,
  sanitizePoseSnapshot,
  type AnimaPoseClip,
  type AnimaPoseClipPose,
  type AnimaPoseClipPoseResolver,
  type AnimaPoseSnapshot,
} from "./schema";

export type AnimaPoseClipChannelAnalysis = {
  humanoid: boolean;
  expressions: boolean;
  avatarVfx: boolean;
  sceneVfx: boolean;
  particleVfx: boolean;
  sfx: boolean;
};

export function analyzeAnimaPoseClipChannels(
  clip: AnimaPoseClip,
  resolvePoseRef: AnimaPoseClipPoseResolver = () => null,
): AnimaPoseClipChannelAnalysis {
  const sanitizedClip = parseAnimaPoseClip(clip);
  const analysis: AnimaPoseClipChannelAnalysis = {
    humanoid: false,
    expressions: false,
    avatarVfx: false,
    sceneVfx: false,
    particleVfx: false,
    sfx: false,
  };

  if (sanitizedClip.basePose) {
    applySnapshotChannels(
      analysis,
      resolvePoseSnapshot(sanitizedClip.basePose, resolvePoseRef),
    );
  }

  for (const pose of Object.values(sanitizedClip.poses)) {
    applySnapshotChannels(
      analysis,
      resolveClipPoseSnapshot(pose, resolvePoseRef),
    );
  }

  for (const event of sanitizedClip.events ?? []) {
    if (event.kind === "avatar_vfx") {
      analysis.avatarVfx = true;
    } else if (event.kind === "scene_vfx") {
      analysis.sceneVfx = true;
    } else if (event.kind === "particle_vfx") {
      analysis.particleVfx = true;
    } else if (event.kind === "sfx") {
      analysis.sfx = true;
    }
  }

  return analysis;
}

function resolveClipPoseSnapshot(
  pose: AnimaPoseClipPose,
  resolvePoseRef: AnimaPoseClipPoseResolver,
): AnimaPoseSnapshot | null {
  if (isAnimaPoseClipRef(pose)) {
    return resolvePoseSnapshot(pose.ref, resolvePoseRef);
  }
  return pose;
}

function resolvePoseSnapshot(
  poseId: string,
  resolvePoseRef: AnimaPoseClipPoseResolver,
): AnimaPoseSnapshot | null {
  const resolvedPose = resolvePoseRef(poseId);
  return resolvedPose
    ? sanitizePoseSnapshot(resolvedPose, poseId, false)
    : null;
}

function applySnapshotChannels(
  analysis: AnimaPoseClipChannelAnalysis,
  snapshot: AnimaPoseSnapshot | null,
): void {
  if (!snapshot) return;
  if (Object.keys(snapshot.humanoid ?? {}).length > 0) {
    analysis.humanoid = true;
  }
  if (Object.keys(snapshot.expressions ?? {}).length > 0) {
    analysis.expressions = true;
  }
}
