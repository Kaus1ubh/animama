import {
  VRMExpressionMorphTargetBind,
  type VRM,
  type VRMExpression,
  type VRMExpressionManager,
} from "@pixiv/three-vrm";
import type { BufferGeometry, Mesh } from "three";

import { isAnimamaFaceExpression } from "./arkitFaceExpressions";
import {
  bindDisplacements,
  bindsCloseLids,
  isOneSidedExpression,
  lidClosureStrength,
} from "./eyelidClosure";

/**
 * Stacking limits for faces Animama builds from a model's own shapes.
 *
 * Content is authored on VRoid faces, whose parts are made to combine: a
 * Reaction keys Joy and Fun eyes together because VRoid's Fun eyes only
 * squint. Where Animama plays those parts as a model's MMD morphs or ARKit
 * mixes (`mmdFaceExpressions.ts`, `arkitFaceExpressions.ts`), the same keys
 * can stack shapes the model never meant to combine: Joy eyes (MMD 笑い) and
 * Fun eyes (なごみ) each close the lids fully, so together they close them
 * half again past shut and fold the lashes; Joy and Fun share one brow and one
 * mouth morph, whose weights then add past 1; and a full smile plus a wide
 * speech shape pulls the mouth corners twice as far.
 *
 * After every expression update, on those expressions only (VRoid faces play
 * their own parts and are untouched):
 *
 * - Lid-closing expressions together close the lids at most once, each
 *   measured as the eyelid closure correction measures it. The strongest
 *   keeps its whole shape and the others give way, in their lid-closing
 *   morphs only, so a whole-face mood keeps its brows and mouth.
 * - A morph they bind moves no further than the furthest any single
 *   expression takes it.
 * - A mouth morph eases back by how much of its motion the current speech
 *   shapes already make, so lip sync keeps its full strength.
 *
 * A single expression, and stacks within these limits, play exactly as
 * authored. The rule lives in the expression manager's update, so every
 * surface that applies expressions inherits it, like the eyelid closure
 * correction.
 */

/** The presets three-vrm's blink override scales; never limited here. */
const BLINK_PRESETS: ReadonlySet<string> = new Set([
  "blink",
  "blinkLeft",
  "blinkRight",
]);

/** The viseme presets lip sync drives. */
const VISEME_PRESETS: readonly string[] = ["aa", "ih", "ou", "ee", "oh"];

/**
 * Smallest share of a mouth morph's motion a speech shape must repeat before
 * the mouth morph eases back for it.
 */
const MOUTH_OVERLAP_MIN_SHARE = 0.05;

/** A morph target on every primitive of one mesh, as binds address it. */
type MorphTarget = { primitives: readonly Mesh[]; index: number };

type LidCloser = {
  expression: VRMExpression;
  /** How far it closes the lids at weight 1 (0–1). */
  closure: number;
  /** The same before capping at shut, to break ties between full closures. */
  strength: number;
  /** Its binds that close the lids: the ones it gives way in. */
  binds: readonly VRMExpressionMorphTargetBind[];
};

type EasedMouthMorph = {
  /** The morph on every mesh that has it. */
  targets: readonly MorphTarget[];
  /** Each speech morph's share of this morph's motion. */
  overlaps: readonly { speech: readonly MorphTarget[]; share: number }[];
};

const installed = new WeakSet<VRMExpressionManager>();

/**
 * Install the stacking limits on a loaded VRM's expression manager. Call once
 * after the face registrations and the eyelid closure correction
 * (`prepareLoadedVrm`); a second call does nothing.
 *
 * @returns Whether any limit applies: false when the model has no
 *   expressions Animama built, as on VRoid faces.
 */
export function installFaceShapeStacking(vrm: VRM): boolean {
  const manager = vrm.expressionManager;
  if (!manager || installed.has(manager)) return false;
  const moods = manager.expressions.filter(
    (expression) =>
      isAnimamaFaceExpression(expression) &&
      !BLINK_PRESETS.has(expression.expressionName) &&
      !VISEME_PRESETS.includes(expression.expressionName),
  );
  if (moods.length === 0) return false;

  const blink = manager.getExpression("blink");
  const blinkMotion = blink ? bindDisplacements(blink.binds) : null;
  const closers: LidCloser[] = blinkMotion
    ? moods
        .filter((expression) => !isOneSidedExpression(expression))
        .map((expression) => {
          const strength = lidClosureStrength(expression, blinkMotion);
          return {
            expression,
            closure: Math.min(1, strength),
            strength,
            // A morph that closes the lids gives way on every mesh it moves,
            // the eye mesh included, so its parts stay together.
            binds: Array.from(groupByMorph(morphBinds(expression)).values())
              .filter((group) => bindsCloseLids(group, blinkMotion))
              .flat(),
          };
        })
        .filter((closer) => closer.closure > 0 && closer.binds.length > 0)
    : [];

  // Each morph the moods bind, with the furthest any one expression takes it.
  const reach = new Map<string, MorphTarget & { reach: number }>();
  for (const mood of moods) {
    for (const bind of morphBinds(mood)) {
      reach.set(morphKey(bind), { ...bind, reach: 0 });
    }
  }
  for (const expression of manager.expressions) {
    for (const bind of morphBinds(expression)) {
      const target = reach.get(morphKey(bind));
      if (target) target.reach = Math.max(target.reach, bind.weight);
    }
  }

  const speech = groupByMorph(
    VISEME_PRESETS.flatMap((name) => morphBinds(manager.getExpression(name))),
  );
  const speechMotions = Array.from(speech.values(), (targets) => ({
    targets,
    motion: morphMotion(targets),
  }));
  const eased: EasedMouthMorph[] = [];
  for (const [name, targets] of groupByMorph(moods.flatMap(morphBinds))) {
    if (speech.has(name)) continue;
    const motion = morphMotion(targets);
    const overlaps = speechMotions
      .map((speechMorph) => ({
        speech: speechMorph.targets,
        share: motionShare(motion, speechMorph.motion),
      }))
      .filter((overlap) => overlap.share >= MOUTH_OVERLAP_MIN_SHARE);
    if (overlaps.length > 0) eased.push({ targets, overlaps });
  }

  const limit = () => {
    limitLidClosure(closers);
    for (const target of reach.values()) {
      if (influence(target) > target.reach) setInfluence(target, target.reach);
    }
    for (const { targets, overlaps } of eased) {
      let repeated = 0;
      for (const { speech: speechTargets, share } of overlaps) {
        repeated += influence(speechTargets[0]!) * share;
      }
      if (repeated <= 0) continue;
      const kept = Math.max(0, 1 - repeated);
      for (const target of targets) {
        setInfluence(target, influence(target) * kept);
      }
    }
  };
  const update = manager.update.bind(manager);
  manager.update = () => {
    update();
    limit();
  };
  installed.add(manager);
  return true;
}

/**
 * Let lid-closing expressions together close the lids at most once: the one
 * closing them most keeps its weight, and each next one keeps only what is
 * left of a single closure, in its lid-closing morphs. Expressions that close
 * them equally (each fully, say) rank by how far past shut they would push
 * them.
 */
function limitLidClosure(closers: readonly LidCloser[]): void {
  const active = closers
    .map((closer) => {
      const weight = appliedWeight(closer.expression);
      return {
        closer,
        weight,
        closing: weight * closer.closure,
        rank: weight * closer.strength,
      };
    })
    .filter(({ closing }) => closing > 0)
    .sort((a, b) => b.closing - a.closing || b.rank - a.rank);
  let left = 1;
  for (const { closer, weight, closing } of active) {
    const kept = Math.min(closing, left);
    left -= kept;
    if (kept >= closing) continue;
    const removed = weight * (1 - kept / closing);
    for (const bind of closer.binds) {
      setInfluence(bind, Math.max(0, influence(bind) - removed * bind.weight));
    }
  }
}

/** The weight three-vrm applied to an expression outside override lists. */
function appliedWeight(expression: VRMExpression): number {
  const weight = expression.outputWeight;
  return expression.isBinary && weight < 1 ? 0 : weight;
}

function morphBinds(
  expression: VRMExpression | null,
): VRMExpressionMorphTargetBind[] {
  return (expression?.binds ?? []).filter(
    (bind): bind is VRMExpressionMorphTargetBind =>
      bind instanceof VRMExpressionMorphTargetBind &&
      bind.primitives.length > 0,
  );
}

function morphKey(target: MorphTarget): string {
  return `${target.primitives[0]!.uuid}:${target.index}`;
}

/**
 * Binds grouped by the morph target's name, so one morph on several meshes
 * (a converter binds each mesh that has the name separately) is one group.
 * A morph without a name is its own group.
 */
function groupByMorph<T extends MorphTarget>(
  binds: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const bind of binds) {
    const dictionary = bind.primitives[0]!.morphTargetDictionary ?? {};
    const name =
      Object.keys(dictionary).find((key) => dictionary[key] === bind.index) ??
      morphKey(bind);
    const group = groups.get(name) ?? [];
    if (!group.some((other) => morphKey(other) === morphKey(bind))) {
      group.push(bind);
    }
    groups.set(name, group);
  }
  return groups;
}

function influence(target: MorphTarget): number {
  return target.primitives[0]!.morphTargetInfluences?.[target.index] ?? 0;
}

function setInfluence(target: MorphTarget, value: number): void {
  for (const primitive of target.primitives) {
    const influences = primitive.morphTargetInfluences;
    if (influences?.[target.index] != null) influences[target.index] = value;
  }
}

/** A morph's per-vertex motion at influence 1, on every mesh given. */
function morphMotion(
  targets: readonly MorphTarget[],
): Map<BufferGeometry, Float32Array> {
  return bindDisplacements(
    targets.map(
      (target) =>
        new VRMExpressionMorphTargetBind({
          primitives: [...target.primitives],
          index: target.index,
          weight: 1,
        }),
    ),
  );
}

/**
 * How much of `base`'s motion `other` repeats at influence 1: their agreeing
 * per-vertex motion, Σ max(0, base · other), as a share of Σ |base|².
 */
function motionShare(
  base: Map<BufferGeometry, Float32Array>,
  other: Map<BufferGeometry, Float32Array>,
): number {
  let agreeing = 0;
  let baseSquared = 0;
  for (const [geometry, motion] of base) {
    const repeat = other.get(geometry);
    for (let i = 0; i < motion.length; i += 3) {
      baseSquared +=
        motion[i]! ** 2 + motion[i + 1]! ** 2 + motion[i + 2]! ** 2;
      if (!repeat) continue;
      agreeing += Math.max(
        0,
        motion[i]! * repeat[i]! +
          motion[i + 1]! * repeat[i + 1]! +
          motion[i + 2]! * repeat[i + 2]!,
      );
    }
  }
  return baseSquared > 0 ? agreeing / baseSquared : 0;
}
