import { LilToonMaterial } from "@mochiya/three-liltoon";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { depthPrepassBlocker } from "./depthPrepass";

/**
 * Regressions for Animama's patch of the installed three-liltoon
 * (`src/frontend/patches/@mochiya__three-liltoon@0.1.9.patch`); they run the
 * package itself, so an upgrade that drops the patch fails here.
 */

describe("three-liltoon opaque passes (Animama patch)", () => {
  it("draws an opaque surface without blending, so it takes the depth pre-pass", () => {
    const surface = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: {},
    });
    expect(surface.blending).toBe(THREE.NoBlending);
    expect(depthPrepassBlocker(surface)).toBeNull();
  });

  it("draws an opaque material's outline pass without blending", () => {
    // `pass` selects a package-owned pass (marked internal in its types).
    const outline = new LilToonMaterial({
      shaderVariant: "Hidden/lilToonOutline",
      pass: "outline",
      properties: {},
    });
    expect(outline.pass).toBe("outline");
    expect(outline.blending).toBe(THREE.NoBlending);
  });

  it("keeps lilToon's blend state where blending can show", () => {
    const additive = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: { _SrcBlend: 1, _DstBlend: 1 },
    });
    expect(additive.blending).toBe(THREE.CustomBlending);
    expect(additive.blendDst).toBe(THREE.OneFactor);

    for (const shaderVariant of [
      "Hidden/lilToonCutout",
      "Hidden/lilToonTransparent",
    ] as const) {
      const blended = new LilToonMaterial({ shaderVariant, properties: {} });
      expect(blended.blending, shaderVariant).toBe(THREE.CustomBlending);
    }
  });

  it("keeps blending where the alpha or equation would not replace", () => {
    const replaced = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: { _DstBlendAlpha: 0 },
    });
    expect(replaced.blending).toBe(THREE.NoBlending);
    const blendedCases: Record<string, number>[] = [
      { _DstBlendAlpha: 1 },
      { _BlendOp: 2 },
    ];
    for (const properties of blendedCases) {
      const blended = new LilToonMaterial({
        shaderVariant: "lilToon",
        properties,
      });
      expect(blended.blending, JSON.stringify(properties)).toBe(
        THREE.CustomBlending,
      );
    }
  });

  it("follows each outline's own blend state", () => {
    const additive = new LilToonMaterial({
      shaderVariant: "Hidden/lilToonOutline",
      pass: "outline",
      properties: { _OutlineDstBlend: 1 },
    });
    expect(additive.blending).toBe(THREE.CustomBlending);
    const cutout = new LilToonMaterial({
      shaderVariant: "Hidden/lilToonCutoutOutline",
      pass: "outline",
      properties: {},
    });
    expect(cutout.blending).toBe(THREE.CustomBlending);
  });

  it("reapplies the rule when a property changes the blend", () => {
    const surface = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: {},
    });
    surface.setProperty("_DstBlend", 1);
    expect(surface.blending).toBe(THREE.CustomBlending);
    surface.setProperty("_DstBlend", 0);
    expect(surface.blending).toBe(THREE.NoBlending);
  });
});

describe("three-liltoon morph weights (Animama patch)", () => {
  /** A mesh with `count` morph targets on a one-triangle geometry. */
  function morphedMesh(material: LilToonMaterial, count: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.Float32BufferAttribute(new Float32Array(9), 3);
    geometry.setAttribute("position", positions);
    geometry.morphAttributes.position = Array.from({ length: count }, () =>
      positions.clone(),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMorphTargets();
    return mesh;
  }

  // Only the capability the weight upload reads.
  const renderer = {
    capabilities: { maxTextureSize: 4096 },
  } as unknown as THREE.WebGLRenderer;

  it("keeps one weight texture per mesh when meshes share a material", () => {
    const material = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: {},
    });
    const face = morphedMesh(material, 155);
    const body = morphedMesh(material, 36);
    const weightsFor = (mesh: THREE.Mesh) => {
      material.updateDeformationUniforms(mesh, renderer);
      return material.uniforms.mochiyaMorphWeights!.value as THREE.DataTexture;
    };

    const faceWeights = weightsFor(face);
    const bodyWeights = weightsFor(body);
    expect(faceWeights.image.width).toBe(155);
    expect(bodyWeights.image.width).toBe(36);
    // Alternating draws reuse each mesh's texture and upload nothing new.
    const versions = [faceWeights.version, bodyWeights.version];
    expect(weightsFor(face)).toBe(faceWeights);
    expect(weightsFor(body)).toBe(bodyWeights);
    expect([faceWeights.version, bodyWeights.version]).toEqual(versions);
    // A changed weight uploads that mesh's texture only.
    face.morphTargetInfluences![3] = 0.5;
    weightsFor(face);
    expect(faceWeights.version).toBe(versions[0]! + 1);
    expect(bodyWeights.version).toBe(versions[1]);
    // Releasing the material releases every mesh's texture, not just the last.
    const disposed: THREE.Texture[] = [];
    for (const texture of [faceWeights, bodyWeights])
      texture.addEventListener("dispose", () => disposed.push(texture));
    material.dispose();
    expect(disposed).toEqual(
      expect.arrayContaining([faceWeights, bodyWeights]),
    );
  });

  it("replaces a mesh's texture when its target count changes", () => {
    const material = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: {},
    });
    const mesh = morphedMesh(material, 4);
    material.updateDeformationUniforms(mesh, renderer);
    const before = material.uniforms.mochiyaMorphWeights!
      .value as THREE.DataTexture;
    let disposed = false;
    before.addEventListener("dispose", () => (disposed = true));
    mesh.geometry.morphAttributes.position!.push(
      mesh.geometry.morphAttributes.position![0]!.clone(),
    );
    mesh.updateMorphTargets();
    material.updateDeformationUniforms(mesh, renderer);
    const after = material.uniforms.mochiyaMorphWeights!
      .value as THREE.DataTexture;
    expect(after).not.toBe(before);
    expect(after.image.width).toBe(5);
    expect(disposed).toBe(true);
    material.dispose();
  });
});

describe("three-liltoon SH direction (Animama patch)", () => {
  // The web lighting ABI supplies only the SH constant term, so OpenLit's
  // dominant-SH-direction `normalize` sees a zero vector; unguarded it is
  // undefined (NaN), and lilToon's environment-lit shadows vary by GPU.
  const SH_DIRECTION =
    "normalize((_Globals.unity_SHAr.xyz + _Globals.unity_SHAg.xyz) + _Globals.unity_SHAb.xyz)";
  const SH_SUM =
    "((_Globals.unity_SHAr.xyz + _Globals.unity_SHAg.xyz) + _Globals.unity_SHAb.xyz)";
  const GUARDED = `(dot(${SH_SUM}, ${SH_SUM}) < 1e-12 ? vec3(0.0) : ${SH_DIRECTION})`;

  it("guards the SH direction in each surface family's vertex shader", () => {
    for (const shaderVariant of [
      "lilToon",
      "Hidden/lilToonCutout",
      "Hidden/lilToonTransparent",
      "Hidden/lilToonRefraction",
      "Hidden/lilToonRefractionBlur",
      "Hidden/lilToonFur",
      "Hidden/lilToonFurCutout",
      "Hidden/lilToonFurTwoPass",
    ] as const) {
      const material = new LilToonMaterial({ shaderVariant, properties: {} });
      const source = material.vertexShader;
      const uses = source.split(SH_DIRECTION).length - 1;
      expect(uses, shaderVariant).toBeGreaterThan(0);
      expect(source.split(GUARDED).length - 1, shaderVariant).toBe(uses);
      material.dispose();
    }
  });
});
