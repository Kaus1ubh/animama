import { parseAnimaPoseClip } from "./parseClip";
import type { AnimaPoseClipPoseResolver } from "./clipVocabulary";
import type { AnimaPoseClipV2 } from "./schemaV2";

export type AnimaPoseClipChannelAnalysis = {
  humanoid: boolean;
  expressions: boolean;
  avatarVfx: boolean;
  sceneVfx: boolean;
  particleVfx: boolean;
  sfx: boolean;
};

export function analyzeAnimaPoseClipChannels(
  clip: AnimaPoseClipV2,
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
    const basePose = resolvePoseRef(sanitizedClip.basePose);
    if (Object.keys(basePose?.humanoid ?? {}).length > 0)
      analysis.humanoid = true;
    if (Object.keys(basePose?.expressions ?? {}).length > 0)
      analysis.expressions = true;
  }

  analysis.humanoid ||= Boolean(
    sanitizedClip.joints ??
    sanitizedClip.rotations ??
    sanitizedClip.hipsPosition ??
    sanitizedClip.hands,
  );
  analysis.expressions ||= Boolean(sanitizedClip.expressions);

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
