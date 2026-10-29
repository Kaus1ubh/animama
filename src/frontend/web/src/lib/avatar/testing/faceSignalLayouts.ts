import { VRMExpression, type VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";

/**
 * Rewrite a loaded test Avatar's face the way another exporter would carry
 * it, before the load-time installs (`prepareLoadedVrm`) run: rename morph
 * targets on every mesh (VRoid's `Fcl_EYE_Close_L` as VRChat's
 * `vrc.blink_left`, say), and leave the named expressions registered but
 * binding nothing, as a VRM 0 file's unbound preset clips load.
 *
 * Throws when a renamed morph target is on no mesh, so a test cannot pass by
 * renaming nothing.
 */
export function rewriteFaceSignals(
  vrm: VRM,
  options: {
    rename?: Readonly<Record<string, string>>;
    empty?: readonly string[];
  },
): void {
  const rename = Object.entries(options.rename ?? {});
  const renamed = new Set<string>();
  // Primitives of one mesh may share a dictionary; rename each once.
  const dictionaries = new Set<Record<string, number>>();
  vrm.scene.traverse((object) => {
    const dictionary = (object as THREE.Mesh).morphTargetDictionary;
    if (dictionary) dictionaries.add(dictionary);
  });
  for (const dictionary of dictionaries) {
    for (const [from, to] of rename) {
      const index = dictionary[from];
      if (index === undefined) continue;
      delete dictionary[from];
      dictionary[to] = index;
      renamed.add(from);
    }
  }
  const missing = rename.filter(([from]) => !renamed.has(from));
  if (missing.length > 0) {
    throw new Error(
      `No mesh has ${missing.map(([from]) => from).join(", ")} to rename`,
    );
  }

  const manager = vrm.expressionManager!;
  for (const name of options.empty ?? []) {
    const existing = manager.getExpression(name);
    if (existing) manager.unregisterExpression(existing);
    manager.registerExpression(new VRMExpression(name));
  }
}
