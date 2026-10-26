import { LilToonMaterial } from "@mochiya/three-liltoon";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { AvatarSilhouetteVFXEntry } from "./types";
import { createSilhouetteOverlay } from "./silhouetteOverlay";

/** Overlay materials for one mesh per source material. */
function overlayMaterials(materials: THREE.Material[]): THREE.Material[] {
  const overlay = createSilhouetteOverlay({
    sources: materials.map(
      (material) => new THREE.Mesh(new THREE.BoxGeometry(), material),
    ),
    art: { width: 4, height: 4 } as unknown as CanvasImageSource,
    entry: {
      fill: "pattern",
      patternScale: 1,
      appearance: { opacity: 1 },
    } as unknown as AvatarSilhouetteVFXEntry,
    frame: () => ({ anchor: new THREE.Vector3(), height: 1 }),
  });
  const result = overlay.meshes.map((mesh) => mesh.material as THREE.Material);
  overlay.dispose();
  return result;
}

describe("createSilhouetteOverlay depth bias", () => {
  it("biases lilToon materials further than glTF and MToon ones", () => {
    const [standard, lilToon] = overlayMaterials([
      new THREE.MeshStandardMaterial(),
      new LilToonMaterial({ properties: {} }),
    ]);
    expect(standard!.polygonOffsetUnits).toBe(-1);
    expect(lilToon!.polygonOffsetUnits).toBe(-8);
  });
});
