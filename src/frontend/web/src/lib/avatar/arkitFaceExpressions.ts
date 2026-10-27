import {
  VRMExpression,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";
import type * as THREE from "three";

import type { ArkitFaceCapability } from "./arkitFaceCapability";
import {
  ARKIT_MOOD_REGION_MIXES,
  ARKIT_NON_MOOD_PART_MIXES,
  type ArkitMix,
  type FaceRegion,
  mergeMixes,
} from "./arkitFaceCompositions";
import { isIrisHideExpression } from "./irisHideExpression";
import { mmdMorphOf, PART_PREFIX_BY_REGION } from "./mmdFaceExpressions";
import { registerArkitExpressions } from "./morphTargetExpressions";
import { VROID_MOOD_PRESETS, type VroidMood } from "./vroidMoodParts";

/**
 * Give an Avatar the face names content keys, region by region (R12).
 *
 * Emotions, Reactions and Gestures key VRM mood presets and VRoid `Fcl_*`
 * parts. Each region (brow, eye, mouth) of a VRoid mood part or mood preset
 * plays, in order: the model's own VRoid part; its standard MMD morph
 * (`registerMmdFace`, registered first); the ARKit mix, when every ARKit
 * shape that region of the table uses resolves (`arkitFaceCompositions.ts`);
 * the VRM preset fallback (`partExpressionFallback.ts`). Every consumer then
 * plays them like any other expression: the emotion map, Reaction overlays,
 * Gesture clips, creator previews, portraits and the eyelid closure
 * correction.
 *
 * The whole-face names (the mood preset and `Fcl_ALL_<Mood>`) play their
 * regions' MMD morphs and ARKit mixes together and replace any preset the
 * file authors, so every such Avatar shows the same faces in Animama (presets
 * baked into the file serve other VRM apps). A mood with a region neither
 * covers keeps the file's own preset whole, since one preset cannot be split
 * by region; without one, the uncovered region stays neutral. An Avatar with
 * VRoid mood parts of its own keeps its authored face for those moods.
 */

/** Where a region of a mood's face comes from. */
export type FaceRegionSource = "vroid" | "mmd" | "arkit" | "preset" | "none";

/** The source of each region of each mood preset's face. */
export type MoodFaceSources = Readonly<
  Record<string, Readonly<Record<FaceRegion, FaceRegionSource>>>
>;

/** The ARKit shapes found on an Avatar, and how its moods play. */
export type ArkitFace = {
  readonly capability: ArkitFaceCapability;
  /** Whether any mood region plays an ARKit mix. */
  readonly playsFacesWithArkit: boolean;
  /** Each mood preset's region sources, as the emotion plays it. */
  readonly moods: MoodFaceSources;
};

/** Expressions this module registered, with their ARKit mixes. */
const arkitMixExpressions = new WeakMap<VRMExpression, ArkitMix>();
/** Whole-face expressions this module composed from several sources. */
const composedExpressions = new WeakSet<VRMExpression>();

/** The ARKit mix an expression plays, if `registerArkitFace` registered it. */
export function arkitMixOf(expression: VRMExpression): ArkitMix | null {
  return arkitMixExpressions.get(expression) ?? null;
}

/**
 * Whether Animama registered this expression (a mix, an MMD morph, a
 * composition or `Fcl_EYE_Iris_Hide`).
 */
export function isAnimamaFaceExpression(expression: VRMExpression): boolean {
  return (
    arkitMixExpressions.has(expression) ||
    composedExpressions.has(expression) ||
    mmdMorphOf(expression) !== null ||
    isIrisHideExpression(expression)
  );
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
 * Whether the model has a face name of its own: a morph target, or an
 * expression Animama did not register.
 */
export function ownFaceNames(vrm: VRM): (name: string) => boolean {
  const morphNames = morphTargetNames(vrm);
  return (name) => {
    if (morphNames.has(name)) return true;
    const expression = vrm.expressionManager?.getExpression(name);
    return Boolean(expression && !isAnimamaFaceExpression(expression));
  };
}

const REGIONS: readonly FaceRegion[] = ["brow", "eye", "mouth"];

/** VRoid's eye-closing parts and the blink preset each plays without ARKit. */
const EYE_CLOSE_BLINKS: Readonly<Record<string, string>> = {
  Fcl_EYE_Close: "blink",
  Fcl_EYE_Close_L: "blinkLeft",
  Fcl_EYE_Close_R: "blinkRight",
};

/**
 * Register an Avatar's ARKit shapes under their canonical names, then fill
 * each mood region and non-mood VRoid part the model and MMD leave empty with
 * its ARKit mix where the region's shapes resolve, and compose the whole-face
 * names from the regions. Safe to call more than once on the same VRM; call
 * it after `registerMmdFace` and before the eyelid closure correction, which
 * measures the result.
 */
export function registerArkitFace(vrm: VRM): ArkitFace {
  const capability = registerArkitExpressions(vrm);
  const manager = vrm.expressionManager;
  const moods: Record<string, Record<FaceRegion, FaceRegionSource>> = {};
  if (!manager) {
    return { capability, playsFacesWithArkit: false, moods };
  }
  const own = ownFaceNames(vrm);
  const resolves = (mix: ArkitMix) =>
    Object.keys(mix).every((shape) => capability.resolved.has(shape));

  /** Bind each shape's own morph binds, scaled by the mix. */
  const addMixBinds = (expression: VRMExpression, mix: ArkitMix) => {
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
  };
  /**
   * Register `name` unless the model has its own (or `replaceOwn`), or an
   * earlier call registered it: the eyelid closure correction is installed on
   * that instance.
   */
  const register = (
    name: string,
    build: (expression: VRMExpression) => void,
    mark: (expression: VRMExpression) => void,
    replaceOwn: boolean,
  ) => {
    const existing = manager.getExpression(name);
    if (existing && isAnimamaFaceExpression(existing)) return;
    if (own(name) && !replaceOwn) return;
    const expression = new VRMExpression(name);
    build(expression);
    if (existing) manager.unregisterExpression(existing);
    mark(expression);
    manager.registerExpression(expression);
  };
  const registerMix = (name: string, mix: ArkitMix, replaceOwn = false) =>
    register(
      name,
      (expression) => addMixBinds(expression, mix),
      (expression) => arkitMixExpressions.set(expression, mix),
      replaceOwn,
    );

  let playsArkit = false;
  for (const [mood, preset] of Object.entries(VROID_MOOD_PRESETS) as [
    VroidMood,
    string,
  ][]) {
    const sources = {} as Record<FaceRegion, FaceRegionSource>;
    const arkitRegions: ArkitMix[] = [];
    const mmdParts: VRMExpression[] = [];
    for (const region of REGIONS) {
      const part = `${PART_PREFIX_BY_REGION[region]}_${mood}`;
      const existing = manager.getExpression(part);
      const mix = ARKIT_MOOD_REGION_MIXES[preset]![region];
      if (own(part)) {
        sources[region] = "vroid";
      } else if (existing && mmdMorphOf(existing)) {
        sources[region] = "mmd";
        mmdParts.push(existing);
      } else if (resolves(mix)) {
        sources[region] = "arkit";
        arkitRegions.push(mix);
        registerMix(part, mix);
      } else {
        sources[region] = "preset";
      }
    }
    const covered = REGIONS.filter((region) =>
      ["mmd", "arkit"].includes(sources[region]),
    );
    // three-vrm registers every preset, so one that binds nothing is absent.
    const ownPreset =
      own(preset) && (manager.getExpression(preset)?.binds.length ?? 0) > 0;
    const anyVroid = REGIONS.some((region) => sources[region] === "vroid");
    if (
      covered.length === 0 ||
      anyVroid ||
      (covered.length < REGIONS.length && ownPreset)
    ) {
      // The file's own face plays this mood whole, region parts aside.
      moods[preset] = Object.fromEntries(
        REGIONS.map((region) => [
          region,
          sources[region] === "vroid" ? "vroid" : ownPreset ? "preset" : "none",
        ]),
      ) as Record<FaceRegion, FaceRegionSource>;
      continue;
    }
    playsArkit ||= arkitRegions.length > 0;
    for (const region of REGIONS) {
      if (sources[region] === "preset") sources[region] = "none";
    }
    moods[preset] = sources;
    // ARKit regions merge as the table's whole-face mix does (a shape in two
    // regions keeps its largest value); MMD regions add their morphs.
    const arkitMix = mergeMixes(arkitRegions);
    const compose = (expression: VRMExpression) => {
      addMixBinds(expression, arkitMix);
      for (const part of mmdParts) {
        for (const bind of part.binds) expression.addBind(bind);
      }
    };
    const markComposite = (expression: VRMExpression) =>
      mmdParts.length > 0
        ? composedExpressions.add(expression)
        : arkitMixExpressions.set(expression, arkitMix);
    register(preset, compose, markComposite, true);
    register(`Fcl_ALL_${mood}`, compose, markComposite, false);
  }
  for (const [part, mix] of Object.entries(ARKIT_NON_MOOD_PART_MIXES)) {
    if (resolves(mix)) registerMix(part, mix);
  }
  // Closing the eyes is what each blink preset does on any model.
  for (const [part, blink] of Object.entries(EYE_CLOSE_BLINKS)) {
    const binds = manager.getExpression(blink)?.binds ?? [];
    if (binds.length === 0) continue;
    register(
      part,
      (expression) => binds.forEach((bind) => expression.addBind(bind)),
      (expression) => composedExpressions.add(expression),
      false,
    );
  }
  return { capability, playsFacesWithArkit: playsArkit, moods };
}
