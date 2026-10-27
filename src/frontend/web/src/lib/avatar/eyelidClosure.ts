import {
  VRMExpressionMorphTargetBind,
  type VRM,
  type VRMExpression,
} from "@pixiv/three-vrm";
import type { BufferGeometry } from "three";

import { arkitMixOf, isAnimamaFaceExpression } from "./arkitFaceExpressions";
import type { ArkitMix } from "./arkitFaceCompositions";
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
 *
 * Other models measure instead of using VRoid's constants (R4). Each
 * lid-closing expression (the mood presets, and the MMD morphs and ARKit
 * mixes `arkitFaceExpressions.ts` and `mmdFaceExpressions.ts` register before
 * this runs, such as MMD's 笑い or relaxed's partial `eyeBlink*`) reduces
 * blink by how far it closes the lids. An ARKit mix uses its share of blink's
 * motion; other expressions use the share at the lid's own vertices scaled so
 * that VRoid's happy counts as closed ({@link CLOSED_LID_PEAK_SHARE}), since a
 * smiling arc also raises the lower lid. One-sided expressions (a wink) are
 * left uncorrected, because three-vrm's blink override would also stop the
 * open eye blinking. VRoid faces (with VRoid eye parts of their own, Andrew
 * included) keep the default profile.
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
 * Applied to VRoid faces without a verified profile (Andrew among them) for
 * each mood expression whose morphs move the eyelids closed, rounded from
 * VRoid measurements: Annie's above and 0.1767 on a VRoid VRM 0 sample.
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
 * Lid vertices, for the measured closure: those blink moves at least this
 * share of its furthest vertex's squared motion (the lid edge, not the skin
 * around it).
 */
const LID_VERTEX_MIN_MOTION = 0.25;

/**
 * The percentile of the lid vertices' closure a measured correction uses: near
 * the most-closed part of the lid, ignoring a few stray vertices.
 */
const LID_CLOSURE_PERCENTILE = 0.9;

/**
 * The lid-vertex share (`eyelidClosingPeakShare`) at which an expression has
 * closed the eyes: VRoid's happy measures 0.69 on Annie, whose verified
 * profile suppresses blink fully, because its lower lids rise too. Dividing by
 * it reproduces Annie's verified relaxed (0.145 / 0.69 = 0.21, against 0.2164)
 * and the default profile on Andrew (0.19, against 0.2).
 */
export const CLOSED_LID_PEAK_SHARE = 0.69;

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
  /**
   * `verified` and `default` (VRoid faces) use a profile for the mood
   * expressions; `measured` measures every lid-closing expression.
   */
  source: "verified" | "default" | "measured";
  /** For `measured`, the shares measured for happy and relaxed (0 if absent). */
  profile: EyelidClosureProfile;
};

/**
 * Install the eyelid closure correction on a loaded VRM. Call once after
 * loading, after expression canonicalization and the face registrations
 * (`registerMmdFace`, `registerArkitFace`).
 *
 * A verified profile is chosen by `vrmSha256`; other VRoid faces use the
 * default profile and other models are measured. Expressions Animama registered (MMD morphs, ARKit mixes and their
 * compositions) are measured on every model. VRoid eye parts that exist only
 * as morph targets are registered as expressions first, so the correction is
 * installed on the instances the runtime later drives. An expression that
 * declares its own `overrideBlink` keeps the native behavior, so it is never
 * corrected twice.
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

  const digest = vrmSha256?.trim().toLowerCase() ?? "";
  const verified = VERIFIED_EYELID_CLOSURE_PROFILES[digest];
  const vroidFace = PART_EXPRESSIONS.some((name) => {
    const expression = manager.getExpression(name);
    return expression !== null && !isAnimamaFaceExpression(expression);
  });
  const blinkMotion = morphDisplacements(blink);
  const share = (expression: VRMExpression) =>
    eyelidClosingShare(morphDisplacements(expression), blinkMotion);
  const closes = (expression: VRMExpression) =>
    share(expression) >= EYELID_CLOSING_MIN_SHARE;

  const correct = (expression: VRMExpression, amount: number) => {
    if (amount <= 0 || expression.overrideBlink !== "none") return;
    // Replaces the library's `none` amount (always 0) for this instance only.
    Object.defineProperty(expression, "overrideBlinkAmount", {
      configurable: true,
      get: () => amount * expression.outputWeight,
    });
  };
  /**
   * Correct by the lid closure measured on the model, when it closes the lids
   * and is not one-sided.
   */
  const correctMeasured = (expression: VRMExpression): number => {
    if (isOneSided(expression)) return 0;
    // ARKit mixes keep their share along blink (as reviewed with #688); other
    // expressions are calibrated on VRoid's happy, which closes the eyes fully.
    const measured = arkitMixOf(expression)
      ? Math.min(1, share(expression))
      : Math.min(
          1,
          eyelidClosingPeakShare(morphDisplacements(expression), blinkMotion) /
            CLOSED_LID_PEAK_SHARE,
        );
    if (measured < EYELID_CLOSING_MIN_SHARE) return 0;
    correct(expression, measured);
    return measured;
  };

  let correction: EyelidClosureCorrection;
  if (verified || vroidFace) {
    const profile = verified
      ? verified.profile
      : defaultProfileFor(vrm, closes);
    correction = { source: verified ? "verified" : "default", profile };
    for (const { name, profile: entry } of CORRECTED_EXPRESSIONS) {
      const expression = manager.getExpression(name);
      if (!expression || isAnimamaFaceExpression(expression)) continue;
      // An unverified face corrects each expression only if it closes the lids.
      correct(expression, verified || closes(expression) ? profile[entry] : 0);
    }
  } else {
    const profile = { happy: 0, relaxed: 0 };
    for (const { name, profile: entry } of CORRECTED_EXPRESSIONS) {
      const expression = manager.getExpression(name);
      if (!expression || isAnimamaFaceExpression(expression)) continue;
      const measured = correctMeasured(expression);
      if (name === entry) profile[entry] = measured;
    }
    correction = { source: "measured", profile };
  }
  for (const expression of manager.expressions) {
    // The blink presets are what the correction overrides, never corrected.
    if (BLINK_PRESETS.has(expression.expressionName)) continue;
    if (isAnimamaFaceExpression(expression)) correctMeasured(expression);
  }
  return correction;
}

/** The presets three-vrm's blink override scales. */
const BLINK_PRESETS: ReadonlySet<string> = new Set([
  "blink",
  "blinkLeft",
  "blinkRight",
]);

/**
 * Whether an expression closes one eye only: an ARKit mix that moves one
 * side's shape without the other's, or a VRoid one-eye part (`…_L`, `…_R`).
 */
function isOneSided(expression: VRMExpression): boolean {
  const mix = arkitMixOf(expression);
  return mix ? isOneSidedMix(mix) : /_(L|R)$/.test(expression.expressionName);
}

/**
 * How far an expression closes the lids, for tests and tools: blink's motion
 * shared on average and at the lid's own vertices (the measured correction).
 * Null without the expression or a blink.
 */
export function measureEyelidClosure(
  vrm: VRM,
  expressionName: string,
): { average: number; peak: number } | null {
  const manager = vrm.expressionManager;
  const blink = manager?.getExpression("blink");
  const expression = manager?.getExpression(expressionName);
  if (!blink || !expression) return null;
  const blinkMotion = morphDisplacements(blink);
  const motion = morphDisplacements(expression);
  return {
    average: eyelidClosingShare(motion, blinkMotion),
    peak: eyelidClosingPeakShare(motion, blinkMotion),
  };
}

/** Whether a mix moves one side's shape without the other side's. */
function isOneSidedMix(mix: ArkitMix): boolean {
  return Object.keys(mix).some((shape) => {
    const other = shape.endsWith("Left")
      ? shape.replace(/Left$/, "Right")
      : shape.endsWith("Right")
        ? shape.replace(/Right$/, "Left")
        : null;
    return other !== null && !(other in mix);
  });
}

/**
 * The default profile for a VRoid face, keeping each entry only when its whole-face expression
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
      // Animama's own expressions are corrected by their measured share.
      .find((candidate) => candidate && !isAnimamaFaceExpression(candidate));
    return expression ? closes(expression) : false;
  };
  return {
    happy: closing("happy") ? DEFAULT_EYELID_CLOSURE_PROFILE.happy : 0,
    relaxed: closing("relaxed") ? DEFAULT_EYELID_CLOSURE_PROFILE.relaxed : 0,
  };
}

/**
 * How far an expression moves blink's vertices along blink's own motion, as a
 * share of that motion: Σ(expression · blink) / Σ|blink|². An average: enough
 * to tell whether an expression closes the lids at all.
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

/**
 * The share of blink's motion an expression closes at the lid's own vertices
 * (those blink moves at least {@link LID_VERTEX_MIN_MOTION} of its furthest
 * vertex): each vertex's (expression · blink) / |blink|², taking the
 * {@link LID_CLOSURE_PERCENTILE} percentile. An arched smile closes the middle
 * of the lid more than its average along blink shows (about 0.62 on VRoid's
 * happy, which needs 1), so reducing blink by this share keeps every part of
 * the lid at or above shut, while an expression that moves the lid as blink
 * does (an ARKit `eyeBlink` mix) gets its exact share.
 */
function eyelidClosingPeakShare(
  expressionMotion: Map<BufferGeometry, Float32Array>,
  blinkMotion: Map<BufferGeometry, Float32Array>,
): number {
  let furthest = 0;
  for (const blink of blinkMotion.values()) {
    for (let i = 0; i < blink.length; i += 3) {
      furthest = Math.max(
        furthest,
        blink[i]! ** 2 + blink[i + 1]! ** 2 + blink[i + 2]! ** 2,
      );
    }
  }
  if (furthest === 0) return 0;
  const shares: number[] = [];
  for (const [geometry, blink] of blinkMotion) {
    const motion = expressionMotion.get(geometry);
    for (let i = 0; i < blink.length; i += 3) {
      const squared = blink[i]! ** 2 + blink[i + 1]! ** 2 + blink[i + 2]! ** 2;
      if (squared < furthest * LID_VERTEX_MIN_MOTION) continue;
      const along = motion
        ? blink[i]! * motion[i]! +
          blink[i + 1]! * motion[i + 1]! +
          blink[i + 2]! * motion[i + 2]!
        : 0;
      shares.push(Math.max(0, along / squared));
    }
  }
  shares.sort((a, b) => a - b);
  return (
    shares[
      Math.min(
        shares.length - 1,
        Math.floor(shares.length * LID_CLOSURE_PERCENTILE),
      )
    ] ?? 0
  );
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
