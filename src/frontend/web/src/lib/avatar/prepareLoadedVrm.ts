import type { VRM } from "@pixiv/three-vrm";

import {
  type ArkitFace,
  ownFaceNames,
  registerArkitFace,
} from "./arkitFaceExpressions";
import {
  applyEyelidClosureCorrection,
  type EyelidClosureCorrection,
} from "./eyelidClosure";
import { registerIrisHideExpression } from "./irisHideExpression";
import { registerMmdFace } from "./mmdFaceExpressions";

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
 * The face names content keys are registered region by region (MMD morphs,
 * then ARKit mixes, then `Fcl_EYE_Iris_Hide`) before the eyelid closure
 * correction, which measures them. Every step is idempotent.
 *
 * `vrm:inspect` and the motion checks load models without it, because they
 * read the file's own expressions before Animama adds any.
 */
export function prepareLoadedVrm(
  vrm: VRM,
  options: { vrmSha256: string | null | undefined },
): PreparedVrm {
  registerMmdFace(vrm, ownFaceNames(vrm));
  const arkitFace = registerArkitFace(vrm);
  registerIrisHideExpression(vrm, ownFaceNames(vrm));
  const eyelidClosure = applyEyelidClosureCorrection(vrm, options.vrmSha256);
  return { arkitFace, eyelidClosure };
}
