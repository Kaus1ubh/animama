import type { VRMExpression, VRM } from "@pixiv/three-vrm";

import type { FaceRegion } from "./arkitFaceCompositions";
import { morphTargetExpression } from "./morphTargetExpressions";
import type { VroidMood } from "./vroidMoodParts";

/**
 * Standard MMD face morphs as VRoid mood regions (R12).
 *
 * Japanese VRChat models usually carry MMD's standard face morphs, one per
 * face region: brows, eyes and mouth. Where a model has one, the VRoid part
 * for that region and mood (`Fcl_BRW_Joy`, `Fcl_EYE_Fun` …) plays the MMD
 * morph, before any ARKit mix or the mood preset (`registerArkitFace` fills
 * the regions MMD leaves and builds the whole-face names from the regions).
 * Only the standard names are used; author-specific names are not.
 *
 * Regions without a standard morph (sad eyes and mouth, angry mouth) are left
 * to the ARKit mixes or the preset.
 */

/** The VRoid part prefix for each face region. */
export const PART_PREFIX_BY_REGION: Readonly<Record<FaceRegion, string>> = {
  brow: "Fcl_BRW",
  eye: "Fcl_EYE",
  mouth: "Fcl_MTH",
};

/** The standard MMD morph for each mood's regions, where MMD has one. */
export const MMD_REGION_MORPHS: Readonly<
  Record<VroidMood, Readonly<Partial<Record<FaceRegion, string>>>>
> = {
  Joy: { brow: "にこり", eye: "笑い", mouth: "にっこり" },
  Fun: { brow: "にこり", eye: "なごみ", mouth: "にっこり" },
  Sorrow: { brow: "困る" },
  Angry: { brow: "怒り", eye: "じと目" },
  Surprised: { brow: "上", eye: "びっくり", mouth: "お" },
};

/**
 * Non-mood VRoid parts a standard MMD morph plays: `Fcl_EYE_Spread` is the
 * surprised eye region. MMD's お is not used for `Fcl_MTH_Large` or
 * `Fcl_MTH_A`: it is only the Surprised mouth here, and an MMD model's `oh`
 * viseme may bind the same morph.
 */
export const MMD_PART_MORPHS: Readonly<Record<string, string>> = {
  Fcl_EYE_Spread: "びっくり",
};

/**
 * The standard MMD morph for each blink preset. MMD's ウィンク closes the
 * model's left eye, as VRM's `blinkLeft` does. `faceSignals.ts` plays them
 * where the file leaves a blink preset empty.
 */
export const MMD_BLINK_MORPHS = {
  blink: "まばたき",
  blinkLeft: "ウィンク",
  blinkRight: "ウィンク右",
} as const;

/**
 * The standard MMD vowel morph for each VRM viseme preset (VRM's visemes are
 * MMD's あいうえお). `faceSignals.ts` plays them where the file leaves a viseme
 * preset empty.
 */
export const MMD_VOWEL_MORPHS = {
  aa: "あ",
  ih: "い",
  ou: "う",
  ee: "え",
  oh: "お",
} as const;

/** Expressions this module registered, with the MMD morph each plays. */
const mmdMorphExpressions = new WeakMap<VRMExpression, string>();

/** The MMD morph an expression plays, if `registerMmdFace` registered it. */
export function mmdMorphOf(expression: VRMExpression): string | null {
  return mmdMorphExpressions.get(expression) ?? null;
}

/**
 * Whether the model has this face name of its own: a morph target or an
 * expression that Animama did not register.
 */
export type OwnFaceName = (name: string) => boolean;

/**
 * Register, for each mood region and non-mood part whose standard MMD morph
 * the model has, the VRoid part name bound to that morph on every mesh that
 * has it. A part the model has of its own keeps it. Safe to call more than
 * once; call it before `registerArkitFace`, which fills the other regions.
 */
export function registerMmdFace(vrm: VRM, ownFaceName: OwnFaceName): void {
  const manager = vrm.expressionManager;
  if (!manager || !vrm.scene) return;
  const wanted: [string, string][] = [
    ...Object.entries(MMD_REGION_MORPHS).flatMap(([mood, regions]) =>
      Object.entries(regions).map(([region, morph]): [string, string] => [
        `${PART_PREFIX_BY_REGION[region as FaceRegion]}_${mood}`,
        morph,
      ]),
    ),
    ...Object.entries(MMD_PART_MORPHS),
  ];
  for (const [part, morph] of wanted) {
    if (ownFaceName(part)) continue;
    const existing = manager.getExpression(part);
    if (existing && mmdMorphOf(existing) === morph) continue;
    const expression = morphTargetExpression(vrm, part, morph);
    if (!expression) continue;
    if (existing) manager.unregisterExpression(existing);
    mmdMorphExpressions.set(expression, morph);
    manager.registerExpression(expression);
  }
}
