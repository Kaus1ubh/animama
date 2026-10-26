import type { VRM } from "@pixiv/three-vrm";

import { type ArkitFace, registerArkitFace } from "./arkitFaceExpressions";
import {
  applyEyelidClosureCorrection,
  type EyelidClosureCorrection,
} from "./eyelidClosure";

/** What the load-time installs found on a model. */
export type PreparedVrm = {
  readonly arkitFace: ArkitFace;
  readonly eyelidClosure: EyelidClosureCorrection | null;
};

/**
 * The load-time installs every place that loads an Avatar for display runs,
 * in order, so the app (`Avatar.load`), the Gesture review renderer
 * (`scripts/animation-render`) and Avatar test helpers play a model the same
 * way. Call it once after loading and expression canonicalization.
 *
 * ARKit mixes are registered before the eyelid closure correction, which
 * measures them. Both steps are idempotent.
 *
 * `vrm:inspect` and the motion checks load models without it, because they
 * read the file's own expressions before Animama adds any.
 */
export function prepareLoadedVrm(
  vrm: VRM,
  options: { vrmSha256: string | null | undefined },
): PreparedVrm {
  const arkitFace = registerArkitFace(vrm);
  const eyelidClosure = applyEyelidClosureCorrection(vrm, options.vrmSha256);
  return { arkitFace, eyelidClosure };
}
