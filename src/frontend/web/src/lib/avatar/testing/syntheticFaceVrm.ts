import {
  VRMExpression,
  VRMExpressionManager,
  VRMExpressionMorphTargetBind,
  type VRM,
} from "@pixiv/three-vrm";
import * as THREE from "three";

/**
 * A test Avatar with one face mesh whose morph targets have the given names.
 * Morph target `i` moves only vertex `i`, so a test can read each shape's
 * applied influence from `mesh.morphTargetInfluences`. `presets` become VRM
 * expressions bound to the morph target of the same name, as a VRM file's
 * authored expressions would be; other morph targets have no expression until
 * the runtime registers them.
 *
 * The VRM has only a scene and an expression manager: enough for
 * `ExpressionController` and expression registration, not for motion.
 */
export function syntheticFaceVrm(options: {
  morphs: readonly string[];
  presets?: readonly string[];
}): { vrm: VRM; mesh: THREE.Mesh } {
  const { morphs, presets = [] } = options;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Array(morphs.length * 3).fill(0), 3),
  );
  geometry.morphAttributes.position = morphs.map((_, index) => {
    const offsets = new Array(morphs.length * 3).fill(0);
    offsets[index * 3 + 1] = 0.01;
    return new THREE.Float32BufferAttribute(offsets, 3);
  });
  geometry.morphTargetsRelative = true;
  const mesh = new THREE.Mesh(geometry);
  mesh.name = "Face";
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = Object.fromEntries(
    morphs.map((name, index) => [name, index]),
  );

  const scene = new THREE.Group();
  scene.add(mesh);
  const manager = new VRMExpressionManager();
  for (const name of presets) {
    const index = mesh.morphTargetDictionary[name];
    if (index === undefined) {
      throw new Error(`Preset ${name} has no morph target of that name`);
    }
    const expression = new VRMExpression(name);
    expression.addBind(
      new VRMExpressionMorphTargetBind({
        primitives: [mesh],
        index,
        weight: 1,
      }),
    );
    manager.registerExpression(expression);
  }
  return { vrm: { scene, expressionManager: manager } as unknown as VRM, mesh };
}

/** The applied influence of a named morph target on the synthetic face. */
export function morphInfluence(mesh: THREE.Mesh, name: string): number {
  const index = mesh.morphTargetDictionary?.[name];
  if (index === undefined) throw new Error(`No morph target ${name}`);
  return mesh.morphTargetInfluences?.[index] ?? 0;
}
