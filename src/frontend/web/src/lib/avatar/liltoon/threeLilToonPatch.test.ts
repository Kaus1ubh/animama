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
