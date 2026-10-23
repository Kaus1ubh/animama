import {
  VRMExpressionMorphTargetBind,
  type VRM,
  type VRMExpression,
} from "@pixiv/three-vrm";
import type { BufferGeometry } from "three";

import { registerMorphTargetExpressions } from "./morphTargetExpressions";

/**
 * Eyelid closure correction: stop `blink` closing the eyes past shut when a
 * mood expression has already closed them.
 *
 * VRM expressions are clamped one by one, but their morph targets add up on
 * the same vertices. On VRoid faces the whole-face `happy` morph (Joy) already
 * closes the eyelids and `relaxed` (Fun) partly closes them, so a keyed or
 * automatic blink on top pushes the lids past closed and collapses the lashes.
 * The VRM answer is an expression's `overrideBlink`, which three-vrm applies in
 * `VRMExpressionManager.update()` by multiplying `blink`, `blinkLeft` and
 * `blinkRight` by `max(0, 1 − Σ overrideBlinkAmount)`. Models that leave it at
 * `none` get no protection, and the enum cannot express relaxed's partial
 * closure.
 *
 * This module gives happy and relaxed a calibrated `overrideBlinkAmount`, so at
 * every manager update:
 *
 *   effective blink = blink × clamp01(1 − happy × profile.happy − relaxed × profile.relaxed)
 *
 * (each eye's channel alike). VRoid's per-feature eye morphs `Fcl_EYE_Joy` and
 * `Fcl_EYE_Fun` carry all of happy's and relaxed's eyelid motion (the
 * whole-face morph is exactly brow + eye + mouth), so content that keys them
 * instead of the whole face gets the same correction from the same profile. Because the rule lives in the manager, every
 * surface that applies expressions — the chat runtime, creator writes, review
 * renders — inherits it, and expression weights keep their authored values.
 */

/** The share of a full eye closure each mood expression adds at weight 1. */
export type EyelidClosureProfile = {
  readonly happy: number;
  readonly relaxed: number;
};

/**
 * Profiles measured on an Included Avatar's eyelid geometry, keyed by the
 * SHA-256 of the VRM file (the digest Animama already uses for Avatar
 * identity). Happy closes the eyes fully; relaxed contributes its measured
 * share of happy's closure. Andrew has no measured profile and uses the
 * default.
 */
export const VERIFIED_EYELID_CLOSURE_PROFILES: Readonly<
  Record<string, { readonly avatar: string; profile: EyelidClosureProfile }>
> = {
  "15081670b379842b584062c541680472bbbe0a11a19d5aff4cb59a86f88e3fc9": {
    avatar: "AvatarSample_A_1_New",
    profile: { happy: 1, relaxed: 0.2164 },
  },
};

/**
 * Applied to other Avatars for each mood expression whose morphs move the
 * eyelids closed, rounded from VRoid measurements: Annie's above and 0.1767
 * on a VRoid VRM 0 sample.
 */
export const DEFAULT_EYELID_CLOSURE_PROFILE: EyelidClosureProfile = {
  happy: 1,
  relaxed: 0.2,
};

/**
 * Smallest eyelid motion, as a share of blink's motion on the same vertices,
 * that counts as an expression closing the eyelids. The VRoid samples
 * measure about 0.62 for happy and 0.10 for relaxed; a mouth-only smile
 * measures 0.
 */
const EYELID_CLOSING_MIN_SHARE = 0.05;

/**
 * Expressions whose morphs close the eyelids, each with the profile entry that
 * calibrates it.
 */
const CORRECTED_EXPRESSIONS: readonly {
  name: string;
  profile: keyof EyelidClosureProfile;
}[] = [
  { name: "happy", profile: "happy" },
  { name: "relaxed", profile: "relaxed" },
  { name: "Fcl_EYE_Joy", profile: "happy" },
  { name: "Fcl_EYE_Fun", profile: "relaxed" },
];

/** Corrected names a VRM 0 model may keep only as raw morph targets. */
const PART_EXPRESSIONS = ["Fcl_EYE_Joy", "Fcl_EYE_Fun"];

export type EyelidClosureCorrection = {
  source: "verified" | "default";
  profile: EyelidClosureProfile;
};

/**
 * Install the eyelid closure correction on a loaded VRM. Call once after
 * loading (after expression canonicalization).
 *
 * A verified profile is chosen by `vrmSha256`. Other Avatars use the default
 * profile for each mood expression whose morphs measurably close the eyelids,
 * and no correction for the rest. VRoid eye parts that exist only as morph
 * targets are registered as expressions first, so the correction is installed
 * on the instances the runtime later drives. An expression that declares its own
 * `overrideBlink` keeps the native behavior, so it is never corrected twice.
 *
 * @returns The profile in effect, or null when the model has no blink.
 */
export function applyEyelidClosureCorrection(
  vrm: VRM,
  vrmSha256: string | null | undefined,
): EyelidClosureCorrection | null {
  const manager = vrm.expressionManager;
  const blink =
    manager?.getExpression("blink") ??
    manager?.getExpression("blinkLeft") ??
    manager?.getExpression("blinkRight");
  if (!manager || !blink) return null;

  registerMorphTargetExpressions(vrm, PART_EXPRESSIONS);

  const verified =
    VERIFIED_EYELID_CLOSURE_PROFILES[vrmSha256?.trim().toLowerCase() ?? ""];
  const blinkMotion = morphDisplacements(blink);
  const closes = (expression: VRMExpression) =>
    eyelidClosingShare(morphDisplacements(expression), blinkMotion) >=
    EYELID_CLOSING_MIN_SHARE;
  const correction: EyelidClosureCorrection = verified
    ? { source: "verified", profile: verified.profile }
    : { source: "default", profile: defaultProfileFor(vrm, closes) };

  for (const { name, profile } of CORRECTED_EXPRESSIONS) {
    const expression = manager.getExpression(name);
    if (!expression || expression.overrideBlink !== "none") continue;
    // Unverified models correct each expression only if it closes the lids.
    const share =
      verified || closes(expression) ? correction.profile[profile] : 0;
    if (share <= 0) continue;
    // Replaces the library's `none` amount (always 0) for this instance only.
    Object.defineProperty(expression, "overrideBlinkAmount", {
      configurable: true,
      get: () => share * expression.outputWeight,
    });
  }
  return correction;
}

/**
 * The default profile, keeping each entry only when its whole-face expression
 * (or, without one, its VRoid eye part) closes the eyelids.
 */
function defaultProfileFor(
  vrm: VRM,
  closes: (expression: VRMExpression) => boolean,
): EyelidClosureProfile {
  const closing = (entry: keyof EyelidClosureProfile) => {
    const expression = CORRECTED_EXPRESSIONS.filter(
      ({ profile }) => profile === entry,
    )
      .map(({ name }) => vrm.expressionManager?.getExpression(name))
      .find((candidate) => candidate);
    return expression ? closes(expression) : false;
  };
  return {
    happy: closing("happy") ? DEFAULT_EYELID_CLOSURE_PROFILE.happy : 0,
    relaxed: closing("relaxed") ? DEFAULT_EYELID_CLOSURE_PROFILE.relaxed : 0,
  };
}

/**
 * How far an expression moves blink's vertices along blink's own motion, as a
 * share of that motion: Σ(expression · blink) / Σ|blink|².
 */
function eyelidClosingShare(
  expressionMotion: Map<BufferGeometry, Float32Array>,
  blinkMotion: Map<BufferGeometry, Float32Array>,
): number {
  let along = 0;
  let blinkSquared = 0;
  for (const [geometry, blink] of blinkMotion) {
    const motion = expressionMotion.get(geometry);
    for (let i = 0; i < blink.length; i += 1) {
      blinkSquared += blink[i]! * blink[i]!;
      if (motion) along += blink[i]! * motion[i]!;
    }
  }
  return blinkSquared > 0 ? along / blinkSquared : 0;
}

/** Per-vertex morph displacement of an expression at weight 1, per geometry. */
function morphDisplacements(
  expression: VRMExpression,
): Map<BufferGeometry, Float32Array> {
  const result = new Map<BufferGeometry, Float32Array>();
  for (const bind of expression.binds) {
    if (!(bind instanceof VRMExpressionMorphTargetBind)) continue;
    for (const primitive of bind.primitives) {
      const geometry = primitive.geometry;
      const target = geometry.morphAttributes.position?.[bind.index];
      const base = geometry.getAttribute("position");
      if (!target || !base) continue;
      let sum = result.get(geometry);
      if (!sum) {
        sum = new Float32Array(target.count * 3);
        result.set(geometry, sum);
      }
      const relative = geometry.morphTargetsRelative;
      for (let vertex = 0; vertex < target.count; vertex += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = target.getComponent(vertex, axis);
          const delta = relative
            ? value
            : value - base.getComponent(vertex, axis);
          sum[vertex * 3 + axis]! += bind.weight * delta;
        }
      }
    }
  }
  return result;
}
