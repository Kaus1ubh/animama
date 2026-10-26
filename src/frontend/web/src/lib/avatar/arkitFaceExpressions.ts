import {
  VRMExpression,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";
import type * as THREE from "three";

import type { ArkitFaceCapability } from "./arkitFaceCapability";
import {
  ARKIT_MOOD_MIXES,
  ARKIT_PART_MIXES,
  type ArkitMix,
  playsFacesWithArkit,
} from "./arkitFaceCompositions";
import { registerArkitExpressions } from "./morphTargetExpressions";
import { isVroidMoodPart } from "./vroidMoodParts";

/**
 * Give an ARKit Avatar the face names content keys.
 *
 * Emotions, Reactions and Gestures key VRM mood presets and VRoid `Fcl_*`
 * parts. On an Avatar that has every ARKit shape the composition table uses,
 * each mood preset and each table part becomes an expression whose binds are
 * the ARKit shapes' own morph binds scaled by the mix
 * (`arkitFaceCompositions.ts`). Every consumer then plays them like any other
 * expression: the emotion map, Reaction overlays, Gesture clips, creator
 * previews, portraits and the eyelid closure correction.
 *
 * The mood presets replace any the file authors, so every ARKit Avatar shows
 * the same faces in Animama (presets baked into the file serve other VRM
 * apps). An Avatar that has VRoid mood parts of its own, such as a VRoid model
 * with added ARKit shapes, keeps its authored face entirely.
 */

/** The ARKit shapes found on an Avatar, and whether it plays faces with them. */
export type ArkitFace = {
  readonly capability: ArkitFaceCapability;
  readonly playsFacesWithArkit: boolean;
};

/** Expressions this module registered, with their mixes. */
const arkitMixExpressions = new WeakMap<VRMExpression, ArkitMix>();

/** The ARKit mix an expression plays, if `registerArkitFace` registered it. */
export function arkitMixOf(expression: VRMExpression): ArkitMix | null {
  return arkitMixExpressions.get(expression) ?? null;
}

/** Every morph-target name on the Avatar's meshes. */
function morphTargetNames(vrm: VRM): Set<string> {
  const names = new Set<string>();
  vrm.scene?.traverse((object) => {
    for (const name of Object.keys(
      (object as THREE.Mesh).morphTargetDictionary ?? {},
    )) {
      names.add(name);
    }
  });
  return names;
}

/**
 * Whether the Avatar has VRoid mood parts of its own, as morph targets or
 * expressions; mixes registered by an earlier call do not count.
 */
function hasVroidMoodParts(vrm: VRM, morphNames: ReadonlySet<string>): boolean {
  return (
    [...morphNames].some((name) => isVroidMoodPart(name)) ||
    (vrm.expressionManager?.expressions.some(
      (expression) =>
        !arkitMixOf(expression) && isVroidMoodPart(expression.expressionName),
    ) ??
      false)
  );
}

/**
 * Register an Avatar's ARKit shapes under their canonical names and, when it
 * has them all and no VRoid mood parts of its own, its ARKit mood presets and
 * VRoid parts. Safe to call more than once on the same VRM; call it before the
 * eyelid closure correction so the correction sees the mixes.
 */
export function registerArkitFace(vrm: VRM): ArkitFace {
  const capability = registerArkitExpressions(vrm);
  const morphNames = morphTargetNames(vrm);
  const plays =
    playsFacesWithArkit(capability) && !hasVroidMoodParts(vrm, morphNames);
  const manager = vrm.expressionManager;
  if (!plays || !manager) return { capability, playsFacesWithArkit: plays };

  const register = (name: string, mix: ArkitMix, replace: boolean) => {
    const existing = manager.getExpression(name);
    if (existing && (arkitMixOf(existing) || !replace)) return;
    const expression = new VRMExpression(name);
    for (const [shape, value] of Object.entries(mix)) {
      for (const bind of manager.getExpression(shape)?.binds ?? []) {
        if (!(bind instanceof VRMExpressionMorphTargetBind)) continue;
        expression.addBind(
          new VRMExpressionMorphTargetBind({
            primitives: bind.primitives,
            index: bind.index,
            weight: bind.weight * value,
          }),
        );
      }
    }
    if (existing) manager.unregisterExpression(existing);
    arkitMixExpressions.set(expression, mix);
    manager.registerExpression(expression);
  };
  for (const [preset, mix] of Object.entries(ARKIT_MOOD_MIXES)) {
    register(preset, mix, true);
  }
  for (const [part, mix] of Object.entries(ARKIT_PART_MIXES)) {
    // A part the file has as a raw morph becomes its own expression later.
    if (!morphNames.has(part)) register(part, mix, false);
  }
  return { capability, playsFacesWithArkit: plays };
}
