import {
  VRMExpression,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";
import type * as THREE from "three";

import {
  type ArkitFaceCapability,
  resolveArkitFacesPerMesh,
} from "./arkitFaceCapability";

/** The Avatar's meshes that carry named morph targets. */
function morphTargetMeshes(vrm: VRM): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  vrm.scene?.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary) meshes.push(mesh);
  });
  return meshes;
}

const morphNamesOf = (mesh: THREE.Mesh) =>
  Object.keys(mesh.morphTargetDictionary ?? {});

/**
 * Register an expression binding, on each mesh, the morph targets that
 * `morphNamesFor` names for it, at weight 1. Nothing is registered when no
 * mesh has one.
 */
function registerMorphExpression(
  vrm: VRM,
  meshes: readonly THREE.Mesh[],
  expressionName: string,
  morphNamesFor: (mesh: THREE.Mesh, meshIndex: number) => readonly string[],
): void {
  const expression = new VRMExpression(expressionName);
  meshes.forEach((mesh, meshIndex) => {
    for (const morphName of morphNamesFor(mesh, meshIndex)) {
      const index = mesh.morphTargetDictionary?.[morphName];
      if (index === undefined) continue;
      expression.addBind(
        new VRMExpressionMorphTargetBind({
          primitives: [mesh],
          index,
          weight: 1,
        }),
      );
    }
  });
  if (expression.binds.length > 0) {
    vrm.expressionManager!.registerExpression(expression);
  }
}

/**
 * Register expressions that drive raw mesh morph targets by name, such as
 * ARKit blendshapes or VRoid's per-feature `Fcl_*` morphs, which a VRM 0 file
 * keeps as morph targets without expression groups. Each expression binds the
 * morph target on every mesh that has it at weight 1. Names already registered
 * keep their existing expression.
 *
 * @param names Morph target names to register; all of the model's when omitted.
 */
export function registerMorphTargetExpressions(
  vrm: VRM,
  names?: Iterable<string>,
): void {
  const manager = vrm.expressionManager;
  if (!manager || !vrm.scene) return;

  const meshes = morphTargetMeshes(vrm);
  const wanted = new Set(names ?? meshes.flatMap(morphNamesOf));

  for (const name of wanted) {
    if (manager.getExpression(name)) continue;
    registerMorphExpression(vrm, meshes, name, () => [name]);
  }
}

/**
 * Resolve the Avatar's ARKit shapes mesh by mesh and register each under its
 * canonical ARKit name, bound on every mesh to that mesh's own spelling
 * (`MouthSmile_L` on the face, `mouthSmileLeft` on the teeth), so the runtime
 * can address every Avatar's ARKit shapes by one vocabulary. Names already
 * registered keep their existing expression.
 *
 * @returns The Avatar's ARKit shapes; an empty result without a face.
 */
export function registerArkitExpressions(vrm: VRM): ArkitFaceCapability {
  const meshes = vrm.scene ? morphTargetMeshes(vrm) : [];
  const faces = resolveArkitFacesPerMesh(meshes.map(morphNamesOf));
  const manager = vrm.expressionManager;
  if (!manager) return faces.capability;

  for (const canonical of faces.capability.resolved.keys()) {
    if (manager.getExpression(canonical)) continue;
    registerMorphExpression(
      vrm,
      meshes,
      canonical,
      (_, meshIndex) => faces.meshes[meshIndex]?.get(canonical) ?? [],
    );
  }
  return faces.capability;
}
