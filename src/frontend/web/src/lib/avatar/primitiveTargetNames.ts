import type * as THREE from "three";
import type {
  GLTF,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import { createLogger } from "@/lib/logger";

const logger = createLogger("AvatarLoader");

/**
 * Where a glTF mesh's morph-target names come from as Animama loads it:
 *
 * - `none`: the mesh has no morph targets.
 * - `mesh`: mesh-level `extras.targetNames`, which three.js applies itself.
 * - `primitives`: only primitives store names (`primitives[i].extras.targetNames`,
 *   as some exporters write them) and every list agrees; Animama applies them.
 * - `mismatched`: primitive lists disagree with each other or with the target
 *   count, so the targets stay unnamed (Diagnostics:
 *   `morph_target_names_mismatched`).
 * - `unnamed`: nothing names the targets.
 */
export type MeshTargetNameSource =
  | "none"
  | "mesh"
  | "primitives"
  | "mismatched"
  | "unnamed";

/** A mesh's name source and the names that load (empty when none do). */
export type MeshTargetNames = {
  source: MeshTargetNameSource;
  names: readonly string[];
};

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
 * Resolve a glTF mesh definition's morph-target names. Mesh-level names win
 * and are left to three.js. Otherwise the primitives' lists apply when each
 * holds only strings, all are identical and every primitive with targets has
 * that many: glTF requires all primitives of a mesh to share one target list
 * (the mesh's `weights` drive them together), so one list names the targets of
 * every primitive, including a primitive that stores none.
 */
export function resolveMeshTargetNames(meshDef: unknown): MeshTargetNames {
  const mesh = asRecord(meshDef);
  const counts = asArray(mesh?.primitives)
    .map((primitive) => asArray(asRecord(primitive)?.targets).length)
    .filter((count) => count > 0);
  if (counts.length === 0) return { source: "none", names: [] };
  const meshNames = asRecord(mesh?.extras)?.targetNames;
  if (Array.isArray(meshNames)) return { source: "mesh", names: meshNames };

  const lists = asArray(mesh?.primitives).flatMap((primitive) => {
    const names = asRecord(asRecord(primitive)?.extras)?.targetNames;
    return Array.isArray(names) ? [names as unknown[]] : [];
  });
  const [first] = lists;
  if (!first) return { source: "unnamed", names: [] };
  const agree =
    first.every((name) => typeof name === "string") &&
    counts.every((count) => count === first.length) &&
    lists.every(
      (names) =>
        names.length === first.length &&
        names.every((name, index) => name === first[index]),
    );
  return agree
    ? { source: "primitives", names: first as string[] }
    : { source: "mismatched", names: [] };
}

/**
 * Applies per-primitive morph-target names that three.js ignores (it reads
 * only mesh-level `extras.targetNames`) to the loaded meshes'
 * `morphTargetDictionary`, the map Animama's expression, MMD, ARKit and face
 * part lookups read. Each mesh gets the dictionary three would build from the
 * same names at mesh level; the file's JSON (`parser.json`) stays as authored.
 * Meshes with mesh-level names, and every Included Avatar, are untouched.
 * Disagreeing lists are left unnamed with one warning; Diagnostics reports
 * them from the file's facts.
 */
export class PrimitiveTargetNamesPlugin implements GLTFLoaderPlugin {
  readonly name = "ANIMAMA_primitive_target_names";

  private readonly parser: GLTFParser;

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  afterRoot(result: GLTF): null {
    const resolved = asArray(this.parser.json.meshes).map(
      resolveMeshTargetNames,
    );
    const mismatched = resolved.filter(
      ({ source }) => source === "mismatched",
    ).length;
    if (mismatched > 0)
      logger.warn(
        "Load",
        "Mesh parts name their morph targets differently; those targets stay unnamed",
        { reason: "avatar_morph_target_names_mismatched", meshes: mismatched },
      );
    if (!resolved.some(({ source }) => source === "primitives")) return null;

    for (const scene of result.scenes) {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.morphTargetInfluences) return;
        // three records each primitive's mesh index, clones included.
        const meshIndex = this.parser.associations.get(mesh)?.meshes;
        const target = meshIndex === undefined ? null : resolved[meshIndex];
        if (
          target?.source !== "primitives" ||
          target.names.length !== mesh.morphTargetInfluences.length
        )
          return;
        // As three builds it from mesh-level names: a repeated name keeps its
        // last index.
        mesh.morphTargetDictionary = Object.fromEntries(
          target.names.map((name, index) => [name, index]),
        );
      });
    }
    return null;
  }
}
