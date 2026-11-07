import { Matrix4, Quaternion, Vector3 } from "three";
import type {
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import { createLogger } from "@/lib/logger";

const logger = createLogger("AvatarLoader");

/**
 * Humanoid bones mapped to bones that move nothing, and their repair.
 *
 * Some VRChat Avatars map Unity humanoid bones to helper ("dummy") bones that
 * skin no vertices while the mesh follows a chain beside them, for example
 * humanoid thumbs on `Thumb1Dummy`–`Thumb3Dummy` while the thumb mesh follows
 * `Thumb1`–`Thumb3`. Their VRMs inherit the mapping, so no motion on those
 * humanoid bones shows. Every Avatar loader repairs the mapping before
 * three-vrm reads it (`HumanoidBoneRepairPlugin`), and Diagnostics reports
 * the same plan from the file's facts (`humanoid_bones_remapped`,
 * `humanoid_bones_unweighted`). The converter applies the same rules before
 * export (raymond-van/animama-avatar-converter).
 */

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Humanoid bones models often leave unweighted on purpose (eyes moved by
 * expressions, a jaw or toes the mesh ignores). They are never checked.
 */
const UNCHECKED_BONES: ReadonlySet<string> = new Set([
  "leftEye",
  "rightEye",
  "jaw",
  "leftToes",
  "rightToes",
]);

/**
 * How far a counterpart may lie from the dead bone, as a share of the dead
 * bone's offset from its parent. Dummy bones sit almost on the real ones
 * (about 5% of a thumb's base offset apart); another finger lies much farther.
 */
const COUNTERPART_TOLERANCE = 0.25;

/** One humanoid bone moved from the node it was mapped to. */
export type HumanoidBoneRemap = {
  readonly bone: string;
  readonly from: number;
  readonly to: number;
};

/**
 * Humanoid bones to move to the nodes the mesh follows, and checked humanoid
 * bones that move nothing and have no counterpart (left as mapped).
 */
export type HumanoidBoneRepairPlan = {
  readonly remaps: readonly HumanoidBoneRemap[];
  readonly unweighted: readonly string[];
};

/** A skin accessor's values: `get(vertex, component)`. */
export type SkinAccessor = {
  readonly count: number;
  readonly itemSize: number;
  get(index: number, component: number): number;
};

/** The VRM humanoid mapping's bone entries: `VRMC_vrm` first, as three-vrm reads them. */
function humanBoneEntries(
  json: unknown,
): { bone: string; entry: JsonRecord }[] {
  const extensions = asRecord(asRecord(json)?.extensions);
  const vrm1 = asRecord(
    asRecord(asRecord(extensions?.VRMC_vrm)?.humanoid)?.humanBones,
  );
  if (vrm1)
    return Object.entries(vrm1).flatMap(([bone, value]) => {
      const entry = asRecord(value);
      return entry ? [{ bone, entry }] : [];
    });
  return asArray(
    asRecord(asRecord(extensions?.VRM)?.humanoid)?.humanBones,
  ).flatMap((value) => {
    const entry = asRecord(value);
    return entry && typeof entry.bone === "string"
      ? [{ bone: entry.bone, entry }]
      : [];
  });
}

/** Each humanoid bone's node index, from the VRM 1.0 or 0.x mapping. */
export function humanBoneNodes(json: unknown): Map<string, number> {
  const bones = new Map<string, number>();
  for (const { bone, entry } of humanBoneEntries(json))
    if (Number.isInteger(entry.node)) bones.set(bone, entry.node as number);
  return bones;
}

/** Every skinned mesh node's joints and its primitives' JOINTS_n/WEIGHTS_n accessors. */
function skinInfluences(
  json: unknown,
): { joints: unknown[]; pairs: [number, number][] }[] {
  const root = asRecord(json);
  const meshes = asArray(root?.meshes);
  const skins = asArray(root?.skins);
  return asArray(root?.nodes).flatMap((value) => {
    const node = asRecord(value);
    if (!Number.isInteger(node?.mesh) || !Number.isInteger(node?.skin))
      return [];
    const joints = asArray(asRecord(skins[node!.skin as number])?.joints);
    const pairs = asArray(
      asRecord(meshes[node!.mesh as number])?.primitives,
    ).flatMap((primitive) => {
      const attributes = asRecord(asRecord(primitive)?.attributes) ?? {};
      return Object.keys(attributes).flatMap((name): [number, number][] => {
        const set = /^JOINTS_(\d+)$/.exec(name)?.[1];
        const jointsAccessor = attributes[name];
        const weightsAccessor = attributes[`WEIGHTS_${set}`];
        return set !== undefined &&
          Number.isInteger(jointsAccessor) &&
          Number.isInteger(weightsAccessor)
          ? [[jointsAccessor as number, weightsAccessor as number]]
          : [];
      });
    });
    return [{ joints, pairs }];
  });
}

/** The accessors `nodesMovingTheMesh` reads. */
export function skinAccessorIndices(json: unknown): number[] {
  return [
    ...new Set(skinInfluences(json).flatMap(({ pairs }) => pairs.flat())),
  ];
}

/**
 * Which nodes move the mesh themselves: a skin joint some vertex weighs above
 * zero, a node holding an unskinned mesh, or the source of a VRM 1.0 node
 * constraint (`VRMC_node_constraint`), whose destination follows it. Counting
 * every constraint source keeps a bone that drives a skinned chain through a
 * constraint from being remapped onto that chain, where the constraint would
 * overwrite the motion each frame. Null when a skin accessor cannot be read.
 */
export function nodesMovingTheMesh(
  json: unknown,
  read: (accessor: number) => SkinAccessor | null,
): boolean[] | null {
  const nodes = asArray(asRecord(json)?.nodes);
  const carries = nodes.map((value) => {
    const node = asRecord(value);
    return Number.isInteger(node?.mesh) && !Number.isInteger(node?.skin);
  });
  for (const value of nodes) {
    const constraint = asRecord(
      asRecord(asRecord(asRecord(value)?.extensions)?.VRMC_node_constraint)
        ?.constraint,
    );
    for (const kind of ["roll", "aim", "rotation"]) {
      const source = asRecord(constraint?.[kind])?.source;
      if (Number.isInteger(source) && (source as number) < carries.length)
        carries[source as number] = true;
    }
  }
  for (const { joints, pairs } of skinInfluences(json)) {
    for (const [jointsIndex, weightsIndex] of pairs) {
      const jointValues = read(jointsIndex);
      const weightValues = read(weightsIndex);
      if (!jointValues || !weightValues) return null;
      const count = Math.min(jointValues.count, weightValues.count);
      const size = Math.min(jointValues.itemSize, weightValues.itemSize);
      for (let vertex = 0; vertex < count; vertex += 1)
        for (let component = 0; component < size; component += 1) {
          if (!(weightValues.get(vertex, component) > 0)) continue;
          const node = joints[jointValues.get(vertex, component)];
          if (Number.isInteger(node) && (node as number) < carries.length)
            carries[node as number] = true;
        }
    }
  }
  return carries;
}

/** A node's rest transform relative to its parent. */
function localMatrix(node: JsonRecord | null): Matrix4 {
  const matrix = asArray(node?.matrix);
  if (matrix.length === 16 && matrix.every(Number.isFinite))
    return new Matrix4().fromArray(matrix as number[]);
  const vector = (value: unknown, fallback: number[]) => {
    const values = asArray(value);
    return values.length === fallback.length && values.every(Number.isFinite)
      ? (values as number[])
      : fallback;
  };
  return new Matrix4().compose(
    new Vector3(...vector(node?.translation, [0, 0, 0])),
    new Quaternion(...vector(node?.rotation, [0, 0, 0, 1])),
    new Vector3(...vector(node?.scale, [1, 1, 1])),
  );
}

/**
 * Plan the repair of humanoid bones that move nothing: neither the bone nor
 * any descendant moves the mesh (`carries`, per node: `nodesMovingTheMesh`).
 * Eyes, jaw and toes are not checked.
 *
 * A dead bone and the checked humanoid bones below it form a run, repaired
 * together or not at all. Its counterpart is the nearest other child of the
 * dead bone's parent that moves something, is no humanoid bone's node, and
 * lies within `COUNTERPART_TOLERANCE` of the dead bone's offset from its
 * parent. Each humanoid bone below follows the same node path down the
 * counterpart's subtree, taking at each step the nearest child that is no
 * humanoid bone's node. A run with no counterpart, or whose path cannot be
 * followed, is reported as `unweighted` and left as mapped. Bones one run
 * takes are not offered to the next.
 */
export function planHumanoidBoneRepair(
  json: unknown,
  carries: readonly boolean[],
): HumanoidBoneRepairPlan {
  const nodes = asArray(asRecord(json)?.nodes).map(asRecord);
  const isNode = (value: unknown): value is number =>
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < nodes.length;
  const children = nodes.map((node) => asArray(node?.children).filter(isNode));
  const parent = new Map<number, number>();
  children.forEach((list, node) =>
    list.forEach((child) => {
      if (!parent.has(child)) parent.set(child, node);
    }),
  );
  // The ancestors of a node, nearest first; stops at a cycle in a malformed file.
  const ancestors = (node: number) => {
    const found: number[] = [];
    for (let at = parent.get(node); at !== undefined; at = parent.get(at)) {
      if (at === node || found.includes(at)) break;
      found.push(at);
    }
    return found;
  };

  const moves = new Map<number, boolean>();
  const movesSomething = (node: number): boolean => {
    const known = moves.get(node);
    if (known !== undefined) return known;
    moves.set(node, false); // a cycle adds nothing
    const result =
      Boolean(carries[node]) || children[node]!.some(movesSomething);
    moves.set(node, result);
    return result;
  };

  const worlds = new Map<number, Matrix4>();
  const world = (node: number): Matrix4 => {
    let matrix = worlds.get(node);
    if (!matrix) {
      matrix = localMatrix(nodes[node] ?? null);
      for (const ancestor of ancestors(node))
        matrix.premultiply(localMatrix(nodes[ancestor] ?? null));
      worlds.set(node, matrix);
    }
    return matrix;
  };
  const position = (node: number) =>
    new Vector3().setFromMatrixPosition(world(node));
  const distance = (a: number, b: number) =>
    position(a).distanceTo(position(b));

  const bones = humanBoneNodes(json);
  const mapped = new Set(bones.values());
  const dead = [...bones]
    .filter(
      ([bone, node]) =>
        !UNCHECKED_BONES.has(bone) && isNode(node) && !movesSomething(node),
    )
    .map(([bone, node]) => ({ bone, node, depth: ancestors(node).length }))
    .sort((a, b) => a.depth - b.depth || (a.bone < b.bone ? -1 : 1));

  const remaps: HumanoidBoneRemap[] = [];
  const unweighted: string[] = [];
  const handled = new Set<string>();
  for (const { bone, node } of dead) {
    if (handled.has(bone)) continue;
    const run = dead.filter(
      (member) =>
        !handled.has(member.bone) &&
        (member.node === node || ancestors(member.node).includes(node)),
    );
    run.forEach((member) => handled.add(member.bone));
    const resolved = resolveRun(run, node);
    if (resolved) {
      remaps.push(...resolved);
      // A later run must not take the same bones.
      resolved.forEach(({ to }) => mapped.add(to));
    } else unweighted.push(...run.map((member) => member.bone));
  }
  return { remaps, unweighted };

  function resolveRun(
    run: readonly { bone: string; node: number }[],
    root: number,
  ): HumanoidBoneRemap[] | null {
    const rootParent = parent.get(root);
    if (rootParent === undefined) return null;
    const offset = distance(root, rootParent);
    if (!(offset > 0)) return null;
    const candidates = children[rootParent]!.filter(
      (child) =>
        child !== root &&
        !mapped.has(child) &&
        movesSomething(child) &&
        distance(child, root) <= COUNTERPART_TOLERANCE * offset,
    );
    if (candidates.length === 0) return null;
    const counterpart = nearest(candidates, root);
    const result: HumanoidBoneRemap[] = [];
    for (const member of run) {
      // The path from the run's root down to this member, root excluded.
      const path = [member.node, ...ancestors(member.node)];
      const steps = path.slice(0, path.indexOf(root)).reverse();
      let at = counterpart;
      for (const step of steps) {
        const options = children[at]!.filter((child) => !mapped.has(child));
        if (options.length === 0) return null;
        at = nearest(options, step);
      }
      result.push({ bone: member.bone, from: member.node, to: at });
    }
    return new Set(result.map(({ to }) => to)).size === result.length
      ? result
      : null;
  }

  function nearest(options: readonly number[], to: number): number {
    return options.reduce((best, option) =>
      distance(option, to) < distance(best, to) ? option : best,
    );
  }
}

/** Point the remapped humanoid bones at their new nodes in the VRM JSON. */
export function applyHumanoidBoneRepair(
  json: unknown,
  remaps: readonly HumanoidBoneRemap[],
): void {
  const targets = new Map(remaps.map(({ bone, to }) => [bone, to]));
  for (const { bone, entry } of humanBoneEntries(json)) {
    const to = targets.get(bone);
    if (to !== undefined) entry.node = to;
  }
}

/** A loaded accessor as `SkinAccessor` (interleaved or not, normalized or not). */
function skinAccessor(attribute: {
  count: number;
  itemSize: number;
  getComponent(index: number, component: number): number;
}): SkinAccessor {
  return {
    count: attribute.count,
    itemSize: attribute.itemSize,
    get: (index, component) => attribute.getComponent(index, component),
  };
}

/**
 * Repairs a VRM's humanoid mapping before three-vrm reads it
 * (`planHumanoidBoneRepair`), so the app and every tool that loads an Avatar
 * use the same bones. The node indices in `parser.json`'s humanoid are
 * rewritten; the file's bytes, and so its digest, stay as stored. Skin
 * accessors are read through three, after `ready` (the file's decoders);
 * three caches them for its own load. A file that is not a VRM is skipped.
 */
export class HumanoidBoneRepairPlugin implements GLTFLoaderPlugin {
  readonly name = "ANIMAMA_humanoid_bone_repair";

  private readonly parser: GLTFParser;

  private readonly ready: () => Promise<void>;

  constructor(parser: GLTFParser, ready: () => Promise<void>) {
    this.parser = parser;
    this.ready = ready;
  }

  async beforeRoot(): Promise<void> {
    const json: unknown = this.parser.json;
    if (humanBoneNodes(json).size === 0) return;
    let carries: boolean[] | null;
    try {
      await this.ready();
      const accessors = new Map<number, SkinAccessor>();
      await Promise.all(
        skinAccessorIndices(json).map(async (index) => {
          accessors.set(
            index,
            skinAccessor(await this.parser.getDependency("accessor", index)),
          );
        }),
      );
      carries = nodesMovingTheMesh(
        json,
        (index) => accessors.get(index) ?? null,
      );
    } catch (error) {
      // The file's own load reports a file it cannot read.
      logger.debug("Load", "Humanoid bones were not checked", {
        reason: "avatar_humanoid_bones_unchecked",
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!carries) return;
    const plan = planHumanoidBoneRepair(json, carries);
    if (plan.remaps.length > 0) {
      applyHumanoidBoneRepair(json, plan.remaps);
      logger.info(
        "Load",
        "Humanoid bones that moved nothing now use the bones the mesh follows",
        {
          reason: "avatar_humanoid_bones_remapped",
          bones: plan.remaps.map(({ bone }) => bone),
        },
      );
    }
    if (plan.unweighted.length > 0)
      logger.warn(
        "Load",
        "Humanoid bones move no part of the model, so motion on them does not show",
        { reason: "avatar_humanoid_bones_unweighted", bones: plan.unweighted },
      );
  }
}
