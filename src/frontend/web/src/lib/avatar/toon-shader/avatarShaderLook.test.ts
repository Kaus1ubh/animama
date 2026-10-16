import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";
import { describe, expect, it, vi } from "vitest";

import {
  AVATAR_SHADER_LOOK_PRESETS,
  DEFAULT_AVATAR_SHADER_LOOK,
  applyAvatarShaderLook,
  avatarCanvasFilter,
  parseAvatarShaderLook,
  tunedMToonLook,
} from "./avatarShaderLook";
import { lilToonLookProperties } from "./lilToonLook";
import { vroidLookFor } from "./vroidPalette";

const CLOTH = "N00_000_00_Tops_01_CLOTH (Instance)";
const IRIS = "N00_000_00_EyeIris_00_EYE (Instance)";

function avatarWith(...materials: THREE.Material[]): THREE.Object3D {
  const root = new THREE.Group();
  for (const material of materials) {
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  }
  return root;
}

/** A stand-in for a converted `LilToonMaterial`, recording its updates. */
function lilToon(name: string) {
  const map = new THREE.Texture();
  const material = Object.assign(new THREE.Material(), {
    name,
    isLilToonMaterial: true as const,
    map,
    lilToonProperties: {} as Record<string, unknown>,
    lilToonTextures: {} as Record<string, THREE.Texture | null>,
    setProperty: vi.fn((key: string, value: unknown) => {
      material.lilToonProperties[key] = value;
    }),
    setTexture: vi.fn((key: string, texture: THREE.Texture | null) => {
      material.lilToonTextures[key] = texture;
    }),
  });
  return material;
}

function mtoon(name: string): MToonMaterial {
  const material = new MToonMaterial();
  material.name = name;
  return material;
}

describe("parseAvatarShaderLook", () => {
  it("falls back to the defaults for missing or malformed values", () => {
    expect(parseAvatarShaderLook(null)).toEqual(DEFAULT_AVATAR_SHADER_LOOK);
    expect(parseAvatarShaderLook("{not json")).toEqual(
      DEFAULT_AVATAR_SHADER_LOOK,
    );
    expect(parseAvatarShaderLook('{"rim":"high"}')).toEqual(
      DEFAULT_AVATAR_SHADER_LOOK,
    );
  });

  it("keeps stored values inside each control's range", () => {
    expect(
      parseAvatarShaderLook('{"exposure":9,"shadow":-1,"rim":1.25}'),
    ).toEqual({
      ...DEFAULT_AVATAR_SHADER_LOOK,
      exposure: 1.6,
      shadow: 0,
      rim: 1.25,
    });
  });
});

describe("look values", () => {
  const cloth = vroidLookFor(CLOTH)!;

  it("reproduce the tuned palette at the defaults", () => {
    expect(tunedMToonLook(cloth, DEFAULT_AVATAR_SHADER_LOOK)).toEqual({
      shade: cloth.shade,
      rim: cloth.rim,
      outlineWidth: 0.0045,
    });
    const [r, g, b] = cloth.shade;
    const lil = lilToonLookProperties(
      cloth,
      "current",
      DEFAULT_AVATAR_SHADER_LOOK,
    );
    expect(lil._ShadowColor).toEqual([r, g, b, 1]);
    expect(lil._Shadow2ndColor).toEqual([r * 0.8, g * 0.75, b * 0.85, 0.6]);
    expect(lil._OutlineWidth).toBe(0.1);
  });

  it("lighten shadows to white at 0 and darken them above 1", () => {
    const flat = { ...DEFAULT_AVATAR_SHADER_LOOK, shadow: 0 };
    for (const value of tunedMToonLook(cloth, flat).shade) {
      expect(value).toBeCloseTo(1);
    }
    const deep = { ...DEFAULT_AVATAR_SHADER_LOOK, shadow: 2 };
    const shade = tunedMToonLook(cloth, deep).shade;
    shade.forEach((value, index) => {
      expect(value).toBeLessThan(cloth.shade[index]!);
      expect(value).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("applyAvatarShaderLook", () => {
  const settings = {
    ...DEFAULT_AVATAR_SHADER_LOOK,
    shadow: 0,
    rim: 0,
    outline: 2,
  };

  it("updates tuned MToon materials in place and leaves flat parts alone", () => {
    const cloth = mtoon(CLOTH);
    const iris = mtoon(IRIS);
    const irisShade = iris.shadeColorFactor.clone();
    applyAvatarShaderLook(avatarWith(cloth, iris), "mtoon-tuned", settings);

    for (const value of cloth.shadeColorFactor.toArray()) {
      expect(value).toBeCloseTo(1);
    }
    expect(cloth.parametricRimColorFactor.toArray()).toEqual([0, 0, 0]);
    expect(cloth.outlineWidthFactor).toBeCloseTo(0.009);
    expect(iris.shadeColorFactor.equals(irisShade)).toBe(true);
  });

  it("never changes default MToon", () => {
    const cloth = mtoon(CLOTH);
    const before = cloth.shadeColorFactor.clone();
    applyAvatarShaderLook(avatarWith(cloth), "mtoon", settings);
    expect(cloth.shadeColorFactor.equals(before)).toBe(true);
  });

  it("sets lilToon properties through the material", () => {
    const lil = lilToon(CLOTH);
    applyAvatarShaderLook(avatarWith(lil), "liltoon", settings);
    const shadow = lil.lilToonProperties._ShadowColor as number[];
    shadow.forEach((value) => expect(value).toBeCloseTo(1));
    expect(lil.lilToonProperties._RimColor).toEqual([0, 0, 0, 1]);
    expect(lil.lilToonProperties._OutlineWidth).toBe(0.2);
  });

  it("skips lilToon properties that already have the value", () => {
    const lil = lilToon(CLOTH);
    applyAvatarShaderLook(avatarWith(lil), "liltoon", settings);
    lil.setProperty.mockClear();
    applyAvatarShaderLook(avatarWith(lil), "liltoon", settings);
    expect(lil.setProperty).not.toHaveBeenCalled();
  });

  it("switches lilToon between presets in both directions", () => {
    const cloth = lilToon(CLOTH);
    const iris = lilToon(IRIS);
    const root = avatarWith(cloth, iris);
    const nilo = {
      ...DEFAULT_AVATAR_SHADER_LOOK,
      ...AVATAR_SHADER_LOOK_PRESETS.nilotoon,
    };
    applyAvatarShaderLook(root, "liltoon", nilo);
    expect(cloth.lilToonProperties._OutlineFixWidth).toBe(1);
    expect(cloth.lilToonTextures._OutlineTex).toBe(cloth.map);
    // Flat parts take the preset's lighting response but no palette look.
    expect(iris.lilToonProperties._LightMinLimit).toBe(0.2);
    expect(iris.lilToonProperties._ShadowColor).toBeUndefined();
    expect(iris.setTexture).not.toHaveBeenCalled();

    applyAvatarShaderLook(root, "liltoon", DEFAULT_AVATAR_SHADER_LOOK);
    expect(cloth.lilToonProperties._OutlineFixWidth).toBe(0.5);
    expect(cloth.lilToonProperties._UseBacklight).toBe(0);
    expect(cloth.lilToonTextures._OutlineTex).toBeNull();
    expect(iris.lilToonProperties._LightMinLimit).toBe(0.05);
  });
});

describe("parseAvatarShaderLook choices", () => {
  it("keeps valid preset, tone-mapping and filter choices only", () => {
    expect(
      parseAvatarShaderLook(
        '{"lilToonPreset":"nilotoon","toneMapping":"neutral","softGrade":true,"edgeGlow":"yes"}',
      ),
    ).toEqual({
      ...DEFAULT_AVATAR_SHADER_LOOK,
      lilToonPreset: "nilotoon",
      toneMapping: "neutral",
      softGrade: true,
    });
    expect(
      parseAvatarShaderLook('{"lilToonPreset":"nilo","toneMapping":"agx"}'),
    ).toEqual(DEFAULT_AVATAR_SHADER_LOOK);
  });
});

describe("avatarCanvasFilter", () => {
  it("adds no filter by default and combines the enabled ones", () => {
    expect(avatarCanvasFilter(DEFAULT_AVATAR_SHADER_LOOK)).toBeUndefined();
    const filter = avatarCanvasFilter({
      ...DEFAULT_AVATAR_SHADER_LOOK,
      softGrade: true,
      edgeGlow: true,
    });
    expect(filter).toContain("contrast(");
    expect(filter).toContain("drop-shadow(");
  });
});
