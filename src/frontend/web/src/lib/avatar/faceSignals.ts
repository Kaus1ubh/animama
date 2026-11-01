import {
  VRMExpression,
  VRMExpressionMorphTargetBind,
  type VRM,
  type VRMExpressionBind,
  type VRMExpressionManager,
} from "@pixiv/three-vrm";
import type * as THREE from "three";

import { shapeMatchKey, type ArkitFaceCapability } from "./arkitFaceCapability";
import { ARKIT_VOWEL_MIXES, type ArkitMix } from "./arkitFaceCompositions";
import { MMD_BLINK_MORPHS, MMD_VOWEL_MORPHS } from "./mmdFaceExpressions";
import {
  arkitMixBinds,
  morphTargetMeshes,
  registerArkitExpressions,
} from "./morphTargetExpressions";

/**
 * Blink and mouth signals beyond VRM presets (#760 R1, R5).
 *
 * Face part detection, auto-blink, Gesture and effect blinks and viseme lip
 * sync all read the VRM presets `blink`, `blinkLeft`, `blinkRight` and `aa`
 * … `oh`. Avatars converted from VRChat or exported for MMD or face tracking
 * often leave those presets empty or absent and close their eyes and shape
 * their mouths with other shapes. At load (`prepareLoadedVrm`, and again,
 * idempotently, when `ExpressionController` is built), each preset the file
 * leaves empty is registered as an expression bound to the shapes found for
 * it, so every consumer keeps reading the presets.
 *
 * Each signal plays, in order: the file's preset, when it plays something
 * ({@link expressionPlaysSomething}); for `blink` only, the morph binds of
 * the file's own `blinkLeft` and `blinkRight` together (a shape both bind
 * plays once); then the shapes below. Blinks try
 * MMD before ARKit, as Animama filled empty blink presets before this module
 * and as mood regions do, then VRChat. Visemes try the vowel shapes an author
 * made for speech (MMD, then VRChat) before ARKit's vowel mixes, which only
 * approximate them from mouth shapes (`arkitFaceCompositions.json` `vowels`).
 *
 * - `blink`: MMD まばたき, else ウィンク with ウィンク右; ARKit `eyeBlinkLeft`
 *   with `eyeBlinkRight`; VRChat `vrc.blink`, else `vrc.blink_left` with
 *   `vrc.blink_right`.
 * - `blinkLeft`, `blinkRight`: MMD ウィンク, ウィンク右 (the unsuffixed wink
 *   is the model's left eye); ARKit `eyeBlinkLeft`, `eyeBlinkRight`; VRChat
 *   `vrc.blink_left`, `vrc.blink_right`.
 * - `aa`, `ih`, `ou`, `ee`, `oh`: MMD あ, い, う, え, お; VRChat `vrc.v_aa`,
 *   `vrc.v_ih`, `vrc.v_ou`, `vrc.v_e`, `vrc.v_oh`; ARKit's A, I, U, E and O
 *   mixes, when every shape the mix uses resolves.
 *
 * MMD names match exactly. ARKit names resolve as everywhere else
 * (`arkitFaceCapability.ts`), and VRChat names match by the same key:
 * case, separators and the side token's spelling are ignored. A file's
 * non-empty preset is never replaced, and a second call keeps the expressions
 * the first registered (the eyelid closure correction is installed on them).
 */

/** The VRM presets this module can fill, in the order it resolves them. */
export const FACE_SIGNAL_PRESETS = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
] as const;
export type FaceSignalPreset = (typeof FACE_SIGNAL_PRESETS)[number];

/** Where a signal's expression comes from, when Animama filled it. */
export type SynthesizedFaceSignalSource =
  | "left_right"
  | "mmd"
  | "arkit"
  | "vrchat";

/**
 * Where each signal comes from: the file's own preset, one this module filled
 * (from the file's left and right blinks, MMD, ARKit or VRChat shapes), or
 * nothing.
 */
export type FaceSignalSource = "preset" | SynthesizedFaceSignalSource | "none";

export type FaceSignals = Readonly<Record<FaceSignalPreset, FaceSignalSource>>;

/** Shapes from one vocabulary; each list plays together, the first found wins. */
type ShapeLists = readonly (readonly string[])[];

type SignalShapes = {
  mmd: ShapeLists;
  arkit: ArkitMix;
  vrchat: ShapeLists;
};

const vowelShapes = (
  preset: keyof typeof MMD_VOWEL_MORPHS,
  arkit: ArkitMix,
  vrchat: string,
): SignalShapes => ({
  mmd: [[MMD_VOWEL_MORPHS[preset]]],
  arkit,
  vrchat: [[vrchat]],
});

const SIGNAL_SHAPES: Readonly<Record<FaceSignalPreset, SignalShapes>> = {
  blink: {
    mmd: [
      [MMD_BLINK_MORPHS.blink],
      [MMD_BLINK_MORPHS.blinkLeft, MMD_BLINK_MORPHS.blinkRight],
    ],
    arkit: { eyeBlinkLeft: 1, eyeBlinkRight: 1 },
    vrchat: [["vrc.blink"], ["vrc.blink_left", "vrc.blink_right"]],
  },
  blinkLeft: {
    mmd: [[MMD_BLINK_MORPHS.blinkLeft]],
    arkit: { eyeBlinkLeft: 1 },
    vrchat: [["vrc.blink_left"]],
  },
  blinkRight: {
    mmd: [[MMD_BLINK_MORPHS.blinkRight]],
    arkit: { eyeBlinkRight: 1 },
    vrchat: [["vrc.blink_right"]],
  },
  aa: vowelShapes("aa", ARKIT_VOWEL_MIXES.A, "vrc.v_aa"),
  ih: vowelShapes("ih", ARKIT_VOWEL_MIXES.I, "vrc.v_ih"),
  ou: vowelShapes("ou", ARKIT_VOWEL_MIXES.U, "vrc.v_ou"),
  ee: vowelShapes("ee", ARKIT_VOWEL_MIXES.E, "vrc.v_e"),
  oh: vowelShapes("oh", ARKIT_VOWEL_MIXES.O, "vrc.v_oh"),
};

type ShapeSource = Exclude<SynthesizedFaceSignalSource, "left_right">;
const BLINK_ORDER: readonly ShapeSource[] = ["mmd", "arkit", "vrchat"];
const VOWEL_ORDER: readonly ShapeSource[] = ["mmd", "vrchat", "arkit"];
const SHAPE_ORDER: Readonly<Record<FaceSignalPreset, readonly ShapeSource[]>> =
  {
    blink: BLINK_ORDER,
    blinkLeft: BLINK_ORDER,
    blinkRight: BLINK_ORDER,
    aa: VOWEL_ORDER,
    ih: VOWEL_ORDER,
    ou: VOWEL_ORDER,
    ee: VOWEL_ORDER,
    oh: VOWEL_ORDER,
  };

/** Expressions this module registered, with their source. */
const synthesized = new WeakMap<VRMExpression, SynthesizedFaceSignalSource>();

/** Where an expression came from, if `registerFaceSignals` registered it. */
export function faceSignalSourceOf(
  expression: VRMExpression,
): SynthesizedFaceSignalSource | null {
  return synthesized.get(expression) ?? null;
}

/**
 * Whether an expression moves anything. three-vrm registers every preset a
 * VRM 0 file lists, bound or not, and exporters leave unused clips with no
 * binds, binds at weight 0 or binds on shapes the mesh does not have; all of
 * those play nothing. Material and texture binds count as playing.
 */
export function expressionPlaysSomething(
  expression: VRMExpression | null | undefined,
): boolean {
  return (expression?.binds ?? []).some((bind) => {
    if (!(bind instanceof VRMExpressionMorphTargetBind)) return true;
    return (
      bind.weight > 0 &&
      bind.primitives.some(
        (primitive) =>
          bind.index < (primitive.morphTargetInfluences?.length ?? 0),
      )
    );
  });
}

type Speller = (mesh: THREE.Mesh, name: string) => string | null;

/**
 * Find a mesh's morph target spelling a VRChat shape name: the exact name,
 * else a case-insensitive match, else one with the same matching key. Several
 * equal candidates leave the shape unmatched on that mesh. Each mesh's keys
 * are computed once, on first use.
 */
function createVrchatSpeller(): Speller {
  const keysByMesh = new Map<THREE.Mesh, Map<string, string[]>>();
  const keysOf = (mesh: THREE.Mesh) => {
    let keys = keysByMesh.get(mesh);
    if (!keys) {
      keys = new Map();
      for (const morph of Object.keys(mesh.morphTargetDictionary ?? {})) {
        const key = shapeMatchKey(morph);
        keys.set(key, [...(keys.get(key) ?? []), morph]);
      }
      keysByMesh.set(mesh, keys);
    }
    return keys;
  };
  return (mesh, name) => {
    const dictionary = mesh.morphTargetDictionary ?? {};
    if (dictionary[name] !== undefined) return name;
    const lower = name.toLowerCase();
    const caseless = Object.keys(dictionary).filter(
      (morph) => morph.toLowerCase() === lower,
    );
    const candidates =
      caseless.length > 0
        ? caseless
        : (keysOf(mesh).get(shapeMatchKey(name)) ?? []);
    return candidates.length === 1 ? candidates[0]! : null;
  };
}

/** A mesh's morph target spelling an MMD morph name: only the exact name. */
const mmdMorph: Speller = (mesh, name) =>
  mesh.morphTargetDictionary?.[name] === undefined ? null : name;

/**
 * Weight-1 binds for the first list whose every name a mesh has, on every
 * mesh that has each; null when no list is complete.
 */
function shapeListBinds(
  meshes: readonly THREE.Mesh[],
  lists: ShapeLists,
  spell: Speller,
): VRMExpressionMorphTargetBind[] | null {
  for (const names of lists) {
    const binds = names.map((name) =>
      meshes.flatMap((mesh) => {
        const morph = spell(mesh, name);
        const index =
          morph === null ? undefined : mesh.morphTargetDictionary?.[morph];
        return index === undefined
          ? []
          : [
              new VRMExpressionMorphTargetBind({
                primitives: [mesh],
                index,
                weight: 1,
              }),
            ];
      }),
    );
    if (binds.every((found) => found.length > 0)) return binds.flat();
  }
  return null;
}

/**
 * Fill each blink and viseme preset the file leaves empty from the shapes
 * the Avatar has (see the module comment), and report every signal's source.
 * Safe to call more than once: expressions registered earlier are kept.
 * Call it before the other face registrations (`registerMmdFace`,
 * `registerArkitFace`), face part detection and the eyelid closure
 * correction, which all read the presets.
 */
export function registerFaceSignals(vrm: VRM): FaceSignals {
  const sources = Object.fromEntries(
    FACE_SIGNAL_PRESETS.map((preset) => [preset, "none"]),
  ) as Record<FaceSignalPreset, FaceSignalSource>;
  const manager = vrm.expressionManager;
  if (!manager || !vrm.scene) return sources;

  // The file's own presets, read before this call registers any.
  const own = new Map<FaceSignalPreset, VRMExpression | null>(
    FACE_SIGNAL_PRESETS.map((preset) => [
      preset,
      manager.getExpression(preset),
    ]),
  );
  const ownPlays = (preset: FaceSignalPreset) => {
    const expression = own.get(preset);
    return (
      expression !== null &&
      expression !== undefined &&
      !synthesized.has(expression) &&
      expressionPlaysSomething(expression)
    );
  };

  const meshes = morphTargetMeshes(vrm);
  const vrchatMorph = createVrchatSpeller();
  // ARKit shapes are registered under canonical names only when a signal
  // reaches them, so an Avatar with every preset is left untouched.
  let arkit: ArkitFaceCapability | null = null;
  const shapeBinds = (
    source: ShapeSource,
    shapes: SignalShapes,
  ): VRMExpressionBind[] | null => {
    if (source === "mmd") return shapeListBinds(meshes, shapes.mmd, mmdMorph);
    if (source === "vrchat") {
      return shapeListBinds(meshes, shapes.vrchat, vrchatMorph);
    }
    arkit ??= registerArkitExpressions(vrm);
    const capability = arkit;
    const resolves = Object.keys(shapes.arkit).every((shape) =>
      capability.resolved.has(shape),
    );
    return resolves ? arkitMixBinds(manager, shapes.arkit) : null;
  };

  for (const preset of FACE_SIGNAL_PRESETS) {
    const existing = manager.getExpression(preset);
    const earlier = existing ? synthesized.get(existing) : undefined;
    if (earlier) {
      sources[preset] = earlier;
      continue;
    }
    if (ownPlays(preset)) {
      sources[preset] = "preset";
      continue;
    }
    const found = resolveSignal(preset, {
      leftRight:
        preset === "blink" && ownPlays("blinkLeft") && ownPlays("blinkRight")
          ? combinedMorphBinds([own.get("blinkLeft")!, own.get("blinkRight")!])
          : null,
      shapeBinds,
    });
    if (!found) continue;
    register(manager, preset, existing, found.binds, found.source);
    sources[preset] = found.source;
  }
  return sources;
}

/**
 * The morph binds of several expressions as one: each primitive's morph
 * target once, at the largest weight any of them gives it, so a shape both
 * side blinks bind is not driven twice. Material and texture binds are left
 * out; they belong to each side's own preset.
 */
function combinedMorphBinds(
  expressions: readonly VRMExpression[],
): VRMExpressionMorphTargetBind[] {
  const weights = new Map<
    string,
    { primitive: THREE.Mesh; index: number; weight: number }
  >();
  for (const expression of expressions) {
    for (const bind of expression.binds) {
      if (!(bind instanceof VRMExpressionMorphTargetBind)) continue;
      for (const primitive of bind.primitives) {
        const key = `${primitive.uuid}:${bind.index}`;
        const entry = weights.get(key);
        if (!entry || bind.weight > entry.weight) {
          weights.set(key, {
            primitive,
            index: bind.index,
            weight: bind.weight,
          });
        }
      }
    }
  }
  return [...weights.values()].map(
    ({ primitive, index, weight }) =>
      new VRMExpressionMorphTargetBind({
        primitives: [primitive],
        index,
        weight,
      }),
  );
}

/** The first source in a signal's order that the Avatar has, with its binds. */
function resolveSignal(
  preset: FaceSignalPreset,
  args: {
    /** For `blink`: the file's own left and right blinks' morph binds. */
    leftRight: readonly VRMExpressionBind[] | null;
    shapeBinds: (
      source: ShapeSource,
      shapes: SignalShapes,
    ) => VRMExpressionBind[] | null;
  },
): { source: SynthesizedFaceSignalSource; binds: VRMExpressionBind[] } | null {
  if (args.leftRight && args.leftRight.length > 0) {
    return { source: "left_right", binds: [...args.leftRight] };
  }
  for (const source of SHAPE_ORDER[preset]) {
    const binds = args.shapeBinds(source, SIGNAL_SHAPES[preset]);
    if (binds && binds.length > 0) return { source, binds };
  }
  return null;
}

/** Replace a preset (or its absence) with an expression playing `binds`. */
function register(
  manager: VRMExpressionManager,
  preset: FaceSignalPreset,
  existing: VRMExpression | null,
  binds: readonly VRMExpressionBind[],
  source: SynthesizedFaceSignalSource,
): void {
  const expression = new VRMExpression(preset);
  for (const bind of binds) expression.addBind(bind);
  if (existing) manager.unregisterExpression(existing);
  synthesized.set(expression, source);
  manager.registerExpression(expression);
}
