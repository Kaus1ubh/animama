import {
  VRMExpressionMorphTargetBind,
  type VRM,
  type VRMExpression,
} from "@pixiv/three-vrm";
import type { BufferGeometry } from "three";

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
 * (each eye's channel alike). Because the rule lives in the manager, every
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
  "1119bfc689979031151e54e519db45be0f31eb504ec38c71efb905944e2752ae": {
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

const MOOD_EXPRESSIONS = ["happy", "relaxed"] as const;

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
 * and no correction for the rest. An expression that declares its own
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

  const verified =
    VERIFIED_EYELID_CLOSURE_PROFILES[vrmSha256?.trim().toLowerCase() ?? ""];
  const correction: EyelidClosureCorrection = verified
    ? { source: "verified", profile: verified.profile }
    : { source: "default", profile: defaultProfileFor(vrm, blink) };

  for (const name of MOOD_EXPRESSIONS) {
    const expression = manager.getExpression(name);
    const share = correction.profile[name];
    if (!expression || share <= 0 || expression.overrideBlink !== "none") {
      continue;
    }
    // Replaces the library's `none` amount (always 0) for this instance only.
    Object.defineProperty(expression, "overrideBlinkAmount", {
      configurable: true,
      get: () => share * expression.outputWeight,
    });
  }
  return correction;
}

function defaultProfileFor(
  vrm: VRM,
  blink: VRMExpression,
): EyelidClosureProfile {
  const blinkMotion = morphDisplacements(blink);
  const closes = (name: "happy" | "relaxed") => {
    const expression = vrm.expressionManager?.getExpression(name);
    return expression
      ? eyelidClosingShare(morphDisplacements(expression), blinkMotion) >=
          EYELID_CLOSING_MIN_SHARE
      : false;
  };
  return {
    happy: closes("happy") ? DEFAULT_EYELID_CLOSURE_PROFILE.happy : 0,
    relaxed: closes("relaxed") ? DEFAULT_EYELID_CLOSURE_PROFILE.relaxed : 0,
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
