import * as THREE from "three";

/**
 * The parts of three-liltoon's `LilToonMaterial` that Animama's own passes
 * read, without importing the (lazily loaded) package.
 */
export type LilToonSurfaceFacts = {
  isLilToonMaterial?: boolean;
  /** `forward` for the surface; lilToon's helper passes use other values. */
  pass?: string;
  /** `opaque`, `cutout`, `transparent`, …; see three-liltoon's render modes. */
  renderMode?: string;
  /** The authored lilToon properties (`_Cutoff`, `_MainTex_ST`, …). */
  lilToonProperties?: Record<string, unknown>;
  /** The authored lilToon textures by property name (`_AlphaMask`, …). */
  lilToonTextures?: Record<string, THREE.Texture | null>;
};

/**
 * Whether a material is a three-liltoon surface pass, as lilToon's loader
 * builds it for a mesh: not one of lilToon's own outline or helper passes.
 */
export function isLilToonSurface(
  material: THREE.Material,
): material is THREE.Material & LilToonSurfaceFacts {
  const facts = material as THREE.Material & LilToonSurfaceFacts;
  return facts.isLilToonMaterial === true && facts.pass === "forward";
}

/** A lilToon alpha mask: `mode` 1 replaces, 2 multiplies, 3 adds, 4 subtracts. */
export type LilToonAlphaMask = {
  texture: THREE.Texture;
  mode: 1 | 2 | 3 | 4;
  /** The mask's red channel becomes `clamp(red × scale + value)`. */
  scale: number;
  value: number;
  /** From main-texture UVs to the mask's (`_AlphaMask_ST`). */
  transform: THREE.Matrix3;
};

/** Where a lilToon surface's alpha comes from, as its cut-out reads it. */
export type LilToonAlphaSource = {
  /**
   * From mesh UVs to main-texture UVs: `_MainTex_ST`, then the fixed turn of
   * `_MainTex_ScrollRotate` about the centre (its scrolling and spinning over
   * time are left out).
   */
  mainTransform: THREE.Matrix3;
  alphaMask: LilToonAlphaMask | null;
};

/** A vector property as four numbers, or `fallback`. */
function vector4(value: unknown, fallback: readonly number[]): number[] {
  const numbers =
    value instanceof THREE.Vector4
      ? value.toArray()
      : Array.isArray(value)
        ? value
        : null;
  return fallback.map((entry, index) => {
    const number = numbers?.[index];
    return typeof number === "number" && Number.isFinite(number)
      ? number
      : entry;
  });
}

function scalar(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** `uv × (x, y) + (z, w)`, a texture's tiling and offset. */
function tilingOffset([x, y, z, w]: readonly number[]): THREE.Matrix3 {
  return new THREE.Matrix3().set(x, 0, z, 0, y, w, 0, 0, 1);
}

/**
 * How a lilToon surface's alpha is read from its textures, mirroring
 * three-liltoon's shader: the main texture at `mainTransform`, then the
 * alpha mask when `_AlphaMaskMode` is set and `_AlphaMask` is bound. Null for
 * a material that is not a lilToon surface.
 */
export function lilToonAlphaSource(
  material: THREE.Material,
): LilToonAlphaSource | null {
  if (!isLilToonSurface(material)) return null;
  const properties = material.lilToonProperties ?? {};
  const angle = vector4(properties._MainTex_ScrollRotate, [0, 0, 0, 0])[2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Centre, turn, then back: lilToon turns main UVs about (0.5, 0.5).
  const turn = new THREE.Matrix3().set(
    cos,
    -sin,
    0.5 - 0.5 * cos + 0.5 * sin,
    sin,
    cos,
    0.5 - 0.5 * sin - 0.5 * cos,
    0,
    0,
    1,
  );
  const mainTransform = turn.multiply(
    tilingOffset(vector4(properties._MainTex_ST, [1, 1, 0, 0])),
  );
  const mode = Math.round(scalar(properties._AlphaMaskMode, 0));
  const texture = material.lilToonTextures?._AlphaMask ?? null;
  return {
    mainTransform,
    alphaMask:
      texture && mode >= 1 && mode <= 4
        ? {
            texture,
            mode: mode as LilToonAlphaMask["mode"],
            scale: scalar(properties._AlphaMaskScale, 1),
            value: scalar(properties._AlphaMaskValue, 0),
            transform: tilingOffset(
              vector4(properties._AlphaMask_ST, [1, 1, 0, 0]),
            ),
          }
        : null,
  };
}
