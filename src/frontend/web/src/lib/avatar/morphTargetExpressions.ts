import {
  VRMExpression,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";
import type * as THREE from "three";

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

  const meshes: THREE.Mesh[] = [];
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary) meshes.push(mesh);
  });
  const wanted = new Set(
    names ??
      meshes.flatMap((mesh) => Object.keys(mesh.morphTargetDictionary ?? {})),
  );

  for (const name of wanted) {
    if (manager.getExpression(name)) continue;
    const expression = new VRMExpression(name);
    for (const mesh of meshes) {
      const index = mesh.morphTargetDictionary?.[name];
      if (index === undefined) continue;
      expression.addBind(
        new VRMExpressionMorphTargetBind({
          primitives: [mesh],
          index,
          weight: 1,
        }),
      );
    }
    if (expression.binds.length > 0) manager.registerExpression(expression);
  }
}
