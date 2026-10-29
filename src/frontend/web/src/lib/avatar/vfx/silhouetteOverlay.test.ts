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

/** The overlay's uniforms for one primitive drawn with `material`. */
function overlayUniforms(material: THREE.Material) {
  return (overlayMaterials([material])[0] as THREE.ShaderMaterial).uniforms;
}

/** Where a uniform's 3×3 UV transform takes `(u, v)`. */
function transformed(matrix: THREE.Matrix3, u: number, v: number) {
  const point = new THREE.Vector3(u, v, 1).applyMatrix3(matrix);
  return [point.x, point.y];
}

describe("createSilhouetteOverlay on lilToon cut-outs", () => {
  const texture = () => new THREE.DataTexture(new Uint8Array(16), 2, 2);

  it("cuts by _Cutoff and the main texture's alpha", () => {
    const map = texture();
    const uniforms = overlayUniforms(
      new LilToonMaterial({
        shaderVariant: "Hidden/lilToonCutout",
        properties: { _Cutoff: 0.4, _Color: [1, 1, 1, 0.8] },
        map,
      }),
    );
    expect(uniforms.sourceMap!.value).toBe(map);
    expect(uniforms.useSourceMap!.value).toBe(1);
    expect(uniforms.sourceAlphaTest!.value).toBeCloseTo(0.4);
    expect(uniforms.sourceOpacity!.value).toBeCloseTo(0.8);
    expect(uniforms.alphaMaskMode!.value).toBe(0);
  });

  it("ignores the alpha of an opaque lilToon surface, as lilToon does", () => {
    const uniforms = overlayUniforms(
      new LilToonMaterial({
        shaderVariant: "lilToon",
        properties: { _AlphaMaskMode: 1 },
        textures: { _AlphaMask: texture() },
        map: texture(),
      }),
    );
    expect(uniforms.useSourceMap!.value).toBe(0);
    expect(uniforms.alphaMaskMode!.value).toBe(0);
  });

  it("samples the main texture through _MainTex_ST and its fixed rotation", () => {
    const tiled = overlayUniforms(
      new LilToonMaterial({
        shaderVariant: "Hidden/lilToonCutout",
        properties: { _MainTex_ST: [2, 3, 0.1, 0.2] },
        map: texture(),
      }),
    );
    const [u, v] = transformed(tiled.sourceMapTransform!.value, 0.5, 0.5);
    expect(u).toBeCloseTo(1.1);
    expect(v).toBeCloseTo(1.7);

    // A quarter turn about the texture's centre, as lilToon turns it.
    const turned = overlayUniforms(
      new LilToonMaterial({
        shaderVariant: "Hidden/lilToonCutout",
        properties: { _MainTex_ScrollRotate: [0, 0, Math.PI / 2, 0] },
        map: texture(),
      }),
    );
    const [x, y] = transformed(turned.sourceMapTransform!.value, 0.75, 0.5);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.75);
  });

  it("applies the alpha mask lilToon cuts with", () => {
    const mask = texture();
    const uniforms = overlayUniforms(
      new LilToonMaterial({
        shaderVariant: "Hidden/lilToonCutout",
        properties: {
          _AlphaMaskMode: 2,
          _AlphaMaskScale: 2,
          _AlphaMaskValue: -0.5,
          _AlphaMask_ST: [2, 1, 0.5, 0],
        },
        textures: { _AlphaMask: mask },
      }),
    );
    expect(uniforms.alphaMask!.value).toBe(mask);
    expect(uniforms.alphaMaskMode!.value).toBe(2);
    expect(uniforms.alphaMaskScale!.value).toBe(2);
    expect(uniforms.alphaMaskValue!.value).toBe(-0.5);
    const [u, v] = transformed(uniforms.alphaMaskTransform!.value, 0.25, 0.5);
    expect(u).toBeCloseTo(1);
    expect(v).toBeCloseTo(0.5);
    // No main texture: the mask alone shapes the cut.
    expect(uniforms.useSourceMap!.value).toBe(0);
  });

  it("leaves glTF and MToon surfaces without a mask", () => {
    const uniforms = overlayUniforms(
      new THREE.MeshStandardMaterial({ alphaTest: 0.5, map: texture() }),
    );
    expect(uniforms.alphaMaskMode!.value).toBe(0);
    expect(uniforms.useSourceMap!.value).toBe(1);
  });
});
