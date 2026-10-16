import * as THREE from "three";
import { LilToonMaterial, enableLilToon } from "@mochiya/three-liltoon";
import type { VRM } from "@pixiv/three-vrm";

import {
  getAvatarShaderLook,
  lilToonMaterialProperties,
  lilToonOutlineTexture,
  useAvatarShaderLookStore,
  type AvatarShaderLook,
} from "./avatarShaderLook";
import { vroidLookFor } from "./vroidPalette";

/*
 * Rebuild an Avatar's MToon materials as three-liltoon materials. The package
 * only converts its own glTF extension, which VRoid exports never carry, so
 * the VRoid palette supplies shadow, rim and outline colours.
 */

// three-liltoon writes sRGB itself and ignores `renderer.toneMapping`; apply
// three's ACES Filmic curve (the chat canvas's) or its Neutral curve just
// before that conversion, with the debug panel's exposure in place of
// `toneMappingExposure`. A uniform picks the curve, so switching needs no
// recompile.
const exposure = { value: 1 };
const neutralToneMapping = { value: 0 };
function syncToneMapping(look: AvatarShaderLook): void {
  exposure.value = look.exposure;
  neutralToneMapping.value = look.toneMapping === "neutral" ? 1 : 0;
}
syncToneMapping(getAvatarShaderLook());
useAvatarShaderLookStore.subscribe(({ look }) => syncToneMapping(look));

/**
 * Add the tone-mapping uniforms as non-enumerable properties. When a
 * property change switches lilToon's program, it deletes every enumerable
 * key from `uniforms` and re-adds its own, while three can keep uploading
 * from the uniform list it built for that program; enumerable additions
 * would then go missing mid-frame. three looks uniforms up with `in` and
 * by name, which non-enumerable properties satisfy.
 */
function attachToneMappingUniforms(
  uniforms: Record<string, THREE.IUniform>,
): void {
  for (const [name, uniform] of [
    ["animamaExposure", exposure],
    ["animamaNeutralToneMapping", neutralToneMapping],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(uniforms, name)) continue;
    Object.defineProperty(uniforms, name, {
      value: uniform,
      enumerable: false,
      configurable: true,
    });
  }
}

const TONE_MAPPING_GLSL = `
uniform highp float animamaExposure;
uniform highp float animamaNeutralToneMapping;
highp vec3 animamaRRTAndODTFit(highp vec3 v) {
  highp vec3 a = v * (v + 0.0245786) - 0.000090537;
  highp vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
highp vec3 animamaACESFilmic(highp vec3 color) {
  const highp mat3 inputMat = mat3(
    vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const highp mat3 outputMat = mat3(
    vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= animamaExposure / 0.6;
  color = outputMat * animamaRRTAndODTFit(inputMat * color);
  return clamp(color, 0.0, 1.0);
}
// three's NeutralToneMapping (Khronos PBR Neutral).
highp vec3 animamaNeutral(highp vec3 color) {
  const highp float StartCompression = 0.8 - 0.04;
  const highp float Desaturation = 0.15;
  color *= animamaExposure;
  highp float x = min(color.r, min(color.g, color.b));
  highp float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  highp float peak = max(color.r, max(color.g, color.b));
  if (peak < StartCompression) return color;
  highp float d = 1. - StartCompression;
  highp float newPeak = 1. - d * d / (peak + d - StartCompression);
  color *= newPeak / peak;
  highp float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
  return mix(color, vec3(newPeak), g);
}
highp vec3 animamaToneMap(highp vec3 color) {
  return animamaNeutralToneMapping > 0.5
    ? animamaNeutral(color)
    : animamaACESFilmic(color);
}
`;
const SRGB_INPUT =
  "highp vec3 linearColor = max(out_var_SV_Target.rgb, vec3(0.0));";

/**
 * A `LilToonMaterial` with ACES or Neutral tone mapping. Defined as a
 * subclass so clones (Avatar Effect texture composites) keep it.
 */
class ToneMappedLilToonMaterial extends LilToonMaterial {
  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms) {
    if (!shader.fragmentShader.includes(SRGB_INPUT)) return;
    attachToneMappingUniforms(shader.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main()", `${TONE_MAPPING_GLSL}\nvoid main()`)
      .replace(
        SRGB_INPUT,
        "highp vec3 linearColor = animamaToneMap(max(out_var_SV_Target.rgb, vec3(0.0)));",
      );
  }
}

type MToonLike = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  alphaTest: number;
};

function toLilToon(source: MToonLike): LilToonMaterial {
  const look = vroidLookFor(source.name);
  const settings = getAvatarShaderLook();
  const color = source.color ?? new THREE.Color(1, 1, 1);
  const properties: Record<string, number | number[]> = {
    _Color: [color.r, color.g, color.b, source.opacity],
    _Cull: source.side === THREE.DoubleSide ? 0 : 2,
    // lilToon's transparent mode writes depth by default; MToon's does not
    // (unless `transparentWithZWrite`), and silhouette overlays rely on that.
    _ZWrite: source.depthWrite ? 1 : 0,
    _UseShadow: look ? 1 : 0,
    _UseRim: look ? 1 : 0,
    _UseOutline: look ? 1 : 0,
    ...lilToonMaterialProperties(source.name, settings),
  };
  const map = source.map ?? null;
  const outlineTexture = look ? lilToonOutlineTexture(map, settings) : null;
  return new ToneMappedLilToonMaterial({
    name: source.name,
    map,
    ...(outlineTexture ? { textures: { _OutlineTex: outlineTexture } } : {}),
    alphaTest: source.transparent ? 0 : source.alphaTest,
    renderMode: source.transparent
      ? "transparent"
      : source.alphaTest > 0
        ? "cutout"
        : "opaque",
    properties,
  });
}

/**
 * Replace every material on `vrm` with its lilToon equivalent. VRM
 * expressions that bind material colours keep pointing at the old materials
 * and stop applying; morph-target expressions are unaffected.
 */
export function convertVrmToLilToon(vrm: VRM): void {
  const converted = new Map<THREE.Material, LilToonMaterial>();
  const convert = (material: THREE.Material) => {
    // An MToon outline clone (should the glTF patch have missed one) stays
    // MToon: converted, it would draw a second copy of the surface.
    if ((material as { isOutline?: boolean }).isOutline) return material;
    let next = converted.get(material);
    if (!next) {
      next = toLilToon(material as MToonLike);
      converted.set(material, next);
    }
    return next;
  };
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
  converted.forEach((_, source) => source.dispose());
}

/** Install lilToon's outline and special-mode passes on `renderer`. */
export function enableLilToonRendering(
  renderer: THREE.WebGLRenderer,
): () => void {
  return enableLilToon(renderer);
}
