import * as THREE from "three";
import { MToonMaterial } from "@pixiv/three-vrm";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AVATAR_SHADER_LOOK,
  applyAvatarShaderLook,
  lilToonLookProperties,
  parseAvatarShaderLook,
  tunedMToonLook,
} from "./avatarShaderLook";
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
    const lil = lilToonLookProperties(cloth, DEFAULT_AVATAR_SHADER_LOOK);
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
    const setProperty = vi.fn();
    const lil = Object.assign(new THREE.Material(), {
      name: CLOTH,
      isLilToonMaterial: true,
      setProperty,
    });
    applyAvatarShaderLook(avatarWith(lil), "liltoon", settings);
    const shadow = setProperty.mock.calls.find(
      ([name]) => name === "_ShadowColor",
    )?.[1] as number[];
    shadow.forEach((value) => expect(value).toBeCloseTo(1));
    expect(setProperty).toHaveBeenCalledWith("_RimColor", [0, 0, 0, 1]);
    expect(setProperty).toHaveBeenCalledWith("_OutlineWidth", 0.2);
  });
});
