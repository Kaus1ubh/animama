import type { LilToonMaterial } from "@mochiya/three-liltoon";
import * as THREE from "three";

import type { Avatar } from "@/lib/avatar";
import {
  depthPrepassBlocker,
  depthPrepassMeshes,
  lilToonDepthPrepassEnabled,
  setLilToonDepthPrepassEnabled,
} from "@/lib/avatar/liltoon/depthPrepass";
import { isLilToonSurface } from "@/lib/avatar/liltoon/lilToonSurface";
import { AVATAR_FACE_PART_LABELS } from "@/lib/avatar/vfx/faceParts";
import { PrimitiveRegionHider } from "@/lib/avatar/vfx/primitiveRegionHiding";
import { buildRuntimePrimitiveBindings } from "@/lib/avatar/vrmEditorInspection";

import {
  ALL_FEATURES_OFF,
  LILTOON_PROPERTY_FEATURES,
  LILTOON_VARIANT_FEATURES,
  buildLayers,
  firstComponent,
  lilToonFeaturesOf,
  type Blend,
  type FaceRole,
  type Layer,
} from "./breakdownPlan.ts";

/*
 * The scenarios of `effects:bench --breakdown`, applied to a loaded Avatar:
 * each material hidden and alone, each lilToon feature off, each structural
 * layer hidden, and (with a second, Simple load of the same file) chosen
 * materials drawn with their glTF fallbacks. The features group also times
 * the runtime's depth pre-pass off, and prototype changes to how lilToon
 * draws, none of them shipped: blending off on opaque materials (three-liltoon
 * enables it with One and Zero factors), morph targets dropped, and morph
 * weights read from uniforms.
 * Every scenario returns an undo, so one Avatar serves them all. Materials are
 * named by glTF index, never by the file's own names.
 */

export type BreakdownKind = "materials" | "features" | "layers" | "mixed";

/** One drawn primitive of the loaded Avatar. */
type Primitive = {
  bindingKey: string;
  /** glTF material index; null when the primitive has none. */
  materialIndex: number | null;
  mesh: THREE.Mesh;
  material: THREE.Material;
  triangles: number;
  morphTargets: number;
  blend: Blend;
  /** Face parts it holds, whole or as regions (generic English labels). */
  parts: string[];
};

/** One glTF material, as the breakdown reports it. */
type MaterialSummary = {
  index: number | null;
  /** lilToon variant in words, or the three.js material type. */
  kind: string;
  /** Its blend state in words. */
  blendState: string;
  /** Why it takes no depth pre-pass, or null when it takes one. */
  prepassBlocker: string | null;
  /** lilToon features it uses (`breakdownPlan.ts` ids). */
  features: string[];
  primitives: number;
  triangles: number;
  /** Most morph targets on one of its primitives. */
  morphTargets: number;
  parts: string[];
};

type LayerSummary = {
  id: string;
  label: string;
  primitives: number;
  regions: number;
  /** Hidden primitives that also hold parts outside the layer. */
  shared: number;
};

export type Structure = {
  materials: MaterialSummary[];
  primitives: number;
  triangles: number;
  layers: LayerSummary[];
};

type Scenario = {
  id: string;
  group: BreakdownKind;
  label: string;
  /** Applies the change and returns its undo. */
  apply: () => () => void;
};

function asLilToon(material: THREE.Material): LilToonMaterial | null {
  return isLilToonSurface(material) ? (material as LilToonMaterial) : null;
}

function blendOf(material: THREE.Material): Blend {
  const lilToon = asLilToon(material);
  if (lilToon) {
    if (lilToon.renderMode === "transparent") return "transparent";
    return lilToon.renderMode.endsWith("cutout") ? "cutout" : "opaque";
  }
  if (material.transparent) return "transparent";
  return material.alphaTest > 0 ? "cutout" : "opaque";
}

function kindOf(material: THREE.Material): string {
  const lilToon = asLilToon(material);
  if (lilToon) {
    const passes: string[] = [lilToon.renderMode];
    if (
      lilToon.renderMode === "transparent" &&
      lilToon.transparencyMode !== "normal"
    )
      passes.push(lilToon.transparencyMode);
    if (lilToon.featureSet.outline) passes.push("+ outline");
    return `lilToon ${passes.join(" ")}`;
  }
  if ((material as { isMToonMaterial?: boolean }).isMToonMaterial)
    return "MToon";
  return material.type;
}

function lilToonFeatures(material: THREE.Material): string[] {
  const lilToon = asLilToon(material);
  return lilToon
    ? lilToonFeaturesOf({
        shaderVariant: lilToon.shaderVariant,
        properties: lilToon.lilToonProperties,
      })
    : [];
}

function primaryMaterial(mesh: THREE.Mesh): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
}

/** The loaded Avatar's primitives, with their face parts and blending. */
function primitivesOf(avatar: Avatar): Primitive[] {
  const parts = new Map<string, Set<string>>();
  const note = (bindingKey: string, part: string) => {
    const set = parts.get(bindingKey) ?? new Set<string>();
    set.add(part);
    parts.set(bindingKey, set);
  };
  for (const part of Object.values(avatar.facePartMap?.parts ?? {})) {
    const label = AVATAR_FACE_PART_LABELS[part.role];
    for (const bindingKey of part.bindings) note(bindingKey, label);
    for (const region of part.regions ?? [])
      note(region.bindingKey, `${label} (region)`);
  }
  for (const bindingKey of avatar.facePartMap?.eyeWhite ?? [])
    note(bindingKey, "eye white");

  return buildRuntimePrimitiveBindings(avatar).entries.flatMap((entry) => {
    const mesh = entry.object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return [];
    const geometry = mesh.geometry;
    const material = primaryMaterial(mesh);
    const count = geometry.index?.count ?? geometry.attributes.position!.count;
    return [
      {
        bindingKey: entry.bindingKey,
        materialIndex: entry.materialIndex,
        mesh,
        material,
        triangles: Math.floor(count / 3),
        morphTargets: geometry.morphAttributes.position?.length ?? 0,
        blend: blendOf(material),
        parts: [...(parts.get(entry.bindingKey) ?? [])],
      },
    ];
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Hide `objects`; the undo restores each one's own visibility. */
function hide(objects: readonly THREE.Object3D[]): () => void {
  const before = objects.map((object) => object.visible);
  for (const object of objects) object.visible = false;
  return () =>
    objects.forEach((object, index) => {
      object.visible = before[index]!;
    });
}

function uniqueLilToonMaterials(
  primitives: readonly Primitive[],
): LilToonMaterial[] {
  const found = new Set<LilToonMaterial>();
  for (const primitive of primitives) {
    const meshMaterials = Array.isArray(primitive.mesh.material)
      ? primitive.mesh.material
      : [primitive.mesh.material];
    for (const material of meshMaterials) {
      const lilToon = asLilToon(material);
      if (lilToon) found.add(lilToon);
    }
  }
  return [...found];
}

/**
 * Switch `featureIds` off on every lilToon material that uses them; returns
 * the undo and how many materials changed.
 */
function switchOff(
  materials: readonly LilToonMaterial[],
  featureIds: readonly string[],
): { undo: () => void; changed: number } {
  const undos: (() => void)[] = [];
  const changed = new Set<LilToonMaterial>();
  for (const material of materials) {
    for (const feature of LILTOON_PROPERTY_FEATURES) {
      if (!featureIds.includes(feature.id)) continue;
      for (const name of feature.properties) {
        const before = material.lilToonProperties[name];
        if (before === undefined || firstComponent(before) === 0) continue;
        material.setProperty(name, 0);
        undos.push(() => material.setProperty(name, before));
        changed.add(material);
      }
    }
    for (const feature of LILTOON_VARIANT_FEATURES) {
      if (!featureIds.includes(feature.id)) continue;
      const before = material.shaderVariant;
      const after = feature.without(before);
      if (after === null) continue;
      material.shaderVariant = after as LilToonMaterial["shaderVariant"];
      undos.push(() => {
        material.shaderVariant = before;
      });
      changed.add(material);
    }
  }
  return {
    undo: () => undos.reverse().forEach((undo) => undo()),
    changed: changed.size,
  };
}

/**
 * Whether a lilToon material draws opaque colour with blending enabled: One
 * and Zero colour factors under `CustomBlending`. Animama's three-liltoon
 * patch draws opaque surfaces whose alpha also replaces unblended, so this
 * finds cutout materials and opaque ones with another alpha blend. Drawing
 * them without blending gives the same colour; only the canvas alpha can
 * differ, where the alpha factors blend and the material's alpha is below 1.
 */
function blendsLikeOpaque(material: LilToonMaterial): boolean {
  return (
    !material.transparent &&
    material.blending === THREE.CustomBlending &&
    material.blendEquation === THREE.AddEquation &&
    material.blendSrc === THREE.OneFactor &&
    material.blendDst === THREE.ZeroFactor
  );
}

const BLEND_FACTORS: Record<number, string> = {
  [THREE.ZeroFactor]: "0",
  [THREE.OneFactor]: "1",
  [THREE.SrcAlphaFactor]: "srcA",
  [THREE.OneMinusSrcAlphaFactor]: "1-srcA",
  [THREE.DstAlphaFactor]: "dstA",
  [THREE.OneMinusDstAlphaFactor]: "1-dstA",
  [THREE.SrcColorFactor]: "src",
  [THREE.OneMinusSrcColorFactor]: "1-src",
  [THREE.DstColorFactor]: "dst",
  [THREE.OneMinusDstColorFactor]: "1-dst",
};

/** A material's blend state in words, for the structure report. */
function blendStateOf(material: THREE.Material): string {
  const factor = (value: number | null, fallback: number) =>
    BLEND_FACTORS[value ?? fallback] ?? String(value);
  switch (material.blending) {
    case THREE.NoBlending:
      return "blending off";
    case THREE.CustomBlending:
      return `blending ${factor(material.blendSrc, THREE.OneFactor)}·src + ${factor(material.blendDst, THREE.ZeroFactor)}·dst, alpha ${factor(material.blendSrcAlpha, material.blendSrc)}/${factor(material.blendDstAlpha, material.blendDst)}`;
    default:
      return material.transparent ? "normal blending" : "blending off (opaque)";
  }
}

/**
 * Draw `materials` with `blending` (their blend factors stay as lilToon set
 * them); the undo restores each material's own mode.
 */
function setBlending(
  materials: readonly LilToonMaterial[],
  blending: THREE.Blending,
): () => void {
  const before = materials.map((material) => material.blending);
  for (const material of materials) material.blending = blending;
  return () =>
    materials.forEach((material, index) => {
      material.blending = before[index]!;
    });
}

/** Switch the runtime's depth pre-pass off; the undo switches it on again. */
function depthPrepassOff(renderer: THREE.WebGLRenderer): () => void {
  const before = lilToonDepthPrepassEnabled(renderer);
  setLilToonDepthPrepassEnabled(renderer, false);
  return () => setLilToonDepthPrepassEnabled(renderer, before);
}

/**
 * Draw `primitives` without their morph targets, which lilToon's vertex code
 * otherwise walks for every vertex in each pass. The undo restores them.
 */
function dropMorphTargets(primitives: readonly Primitive[]): () => void {
  const geometries = [
    ...new Set(primitives.map((primitive) => primitive.mesh.geometry)),
  ];
  const before = geometries.map((geometry) => geometry.morphAttributes);
  for (const geometry of geometries) geometry.morphAttributes = {};
  return () =>
    geometries.forEach((geometry, index) => {
      geometry.morphAttributes = before[index]!;
    });
}

/**
 * three-liltoon reads each morph weight from a texture (`texelFetch` plus
 * `textureSize`), twice per morph target and vertex, for positions and
 * normals. Three.js itself uploads the weights as the `morphTargetInfluences`
 * uniform array, so this prototype reads them from there instead.
 */
const MORPH_WEIGHT_FUNCTION = /float mochiyaMorphWeight\(int index\) \{[^}]*\}/;
const MORPH_WEIGHT_FROM_UNIFORMS = `uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
float mochiyaMorphWeight(int index) {
	return morphTargetInfluences[index];
}`;

function morphWeightsFromUniforms(
  materials: readonly LilToonMaterial[],
): () => void {
  const patch = (shader: { vertexShader: string }) => {
    shader.vertexShader = shader.vertexShader.replace(
      MORPH_WEIGHT_FUNCTION,
      MORPH_WEIGHT_FROM_UNIFORMS,
    );
  };
  for (const material of materials) {
    material.onBeforeCompile = patch;
    material.needsUpdate = true;
  }
  return () => {
    for (const material of materials) {
      // Back to the prototype's no-op hook.
      delete (material as { onBeforeCompile?: unknown }).onBeforeCompile;
      material.needsUpdate = true;
    }
  };
}

/**
 * Scenarios that switch lilToon features off (each on every material that
 * uses it, then all but transparency together) or change how opaque lilToon
 * materials draw (blending off, a depth pre-pass).
 */
function featureScenarios(
  primitives: readonly Primitive[],
  avatar: Avatar,
  renderer: THREE.WebGLRenderer,
): Scenario[] {
  const materials = uniqueLilToonMaterials(primitives);
  const scenarios: Scenario[] = [];
  const usersOf = (id: string) =>
    materials.filter((material) =>
      lilToonFeaturesOf({
        shaderVariant: material.shaderVariant,
        properties: material.lilToonProperties,
      }).includes(id),
    ).length;
  const features = [
    ...LILTOON_PROPERTY_FEATURES,
    ...LILTOON_VARIANT_FEATURES,
  ].filter((feature) => usersOf(feature.id) > 0);
  for (const feature of features)
    scenarios.push({
      id: `feature:${feature.id}`,
      group: "features",
      label: `${feature.label} off (${usersOf(feature.id)} of ${materials.length} lilToon materials)`,
      apply: () => switchOff(materials, [feature.id]).undo,
    });
  if (features.length > 1)
    scenarios.push({
      id: "feature:all",
      group: "features",
      label: "every feature above off except transparency",
      apply: () => switchOff(materials, ALL_FEATURES_OFF).undo,
    });
  const opaqueBlended = materials.filter(blendsLikeOpaque);
  if (opaqueBlended.length)
    scenarios.push({
      id: "feature:opaque-blending",
      group: "features",
      label: `blending off on materials that blend opaque colour (${opaqueBlended.length} of ${materials.length} lilToon materials; same colour)`,
      apply: () => setBlending(opaqueBlended, THREE.NoBlending),
    });
  // Animama's three-liltoon patch draws opaque surfaces and their outlines
  // unblended; this restores lilToon's own blend state on the surfaces.
  const unblended = materials.filter(
    (material) =>
      material.renderMode === "opaque" &&
      material.blending === THREE.NoBlending,
  );
  if (unblended.length)
    scenarios.push({
      id: "feature:authored-blending",
      group: "features",
      label: `lilToon's own blending on opaque surfaces (${unblended.length} of ${materials.length} lilToon materials; same colour; outlines stay unblended)`,
      apply: () => setBlending(unblended, THREE.CustomBlending),
    });
  const prepassed =
    lilToonDepthPrepassEnabled(renderer) && avatar.scene
      ? depthPrepassMeshes(
          avatar.scene,
          new WeakSet(),
          renderer.getContext().getContextAttributes()?.stencil ?? true,
        ).length
      : 0;
  if (prepassed)
    scenarios.push({
      id: "feature:depth-prepass",
      group: "features",
      label: `depth pre-pass off (it draws ${prepassed} of ${primitives.length} primitives' depth first)`,
      apply: () => depthPrepassOff(renderer),
    });
  const morphed = primitives.filter(
    (primitive) =>
      asLilToon(primitive.material) &&
      primitive.mesh.geometry.morphAttributes.position,
  );
  if (morphed.length) {
    const most = Math.max(
      ...morphed.map((primitive) => primitive.morphTargets),
    );
    scenarios.push({
      id: "feature:morph-targets",
      group: "features",
      label: `morph targets dropped from lilToon primitives (${morphed.length} primitives, up to ${most} targets; the face cannot move)`,
      apply: () => dropMorphTargets(morphed),
    });
    scenarios.push({
      id: "feature:morph-uniforms",
      group: "features",
      label: `morph weights read from a uniform array in the surface pass, not a texture (prototype; outline passes unchanged)`,
      apply: () => morphWeightsFromUniforms(materials),
    });
  }
  return scenarios;
}

/** Render-state changes, applied after feature switches that reset state. */
const RENDER_STATE_CHANGES = ["opaque-blending", "authored-blending"];

/**
 * Apply feature scenarios by id (`shadow`, `outline`, `opaque-blending`,
 * `depth-prepass`, … as a features breakdown lists them) to the whole run.
 * Returns the undo and the ids this Avatar has no scenario for.
 */
export function applyFeatureChanges(
  avatar: Avatar,
  renderer: THREE.WebGLRenderer,
  ids: readonly string[],
): { undo: () => void; unknown: string[] } {
  if (ids.length === 0) return { undo: () => undefined, unknown: [] };
  const scenarios = featureScenarios(primitivesOf(avatar), avatar, renderer);
  const undos: (() => void)[] = [];
  const unknown: string[] = [];
  // A shader-variant switch reapplies lilToon's render state, so blending
  // and the pre-pass go last.
  const ordered = [
    ...ids.filter((id) => !RENDER_STATE_CHANGES.includes(id)),
    ...ids.filter((id) => RENDER_STATE_CHANGES.includes(id)),
  ];
  for (const id of ordered) {
    const scenario = scenarios.find(
      (candidate) => candidate.id === `feature:${id}`,
    );
    if (scenario) undos.push(scenario.apply());
    else unknown.push(id);
  }
  return {
    undo: () => undos.reverse().forEach((undo) => undo()),
    unknown,
  };
}

/** The detected face parts in the plan's terms. */
function layersOf(avatar: Avatar, primitives: Primitive[]): Layer[] {
  const roles: Partial<
    Record<
      FaceRole,
      {
        bindings: readonly string[];
        regions?: readonly {
          bindingKey: string;
          triangles: readonly number[];
        }[];
      }
    >
  > = {};
  for (const part of Object.values(avatar.facePartMap?.parts ?? {}))
    roles[part.role] = { bindings: part.bindings, regions: part.regions };
  return buildLayers({
    roles,
    eyeWhites: avatar.facePartMap?.eyeWhite ?? [],
    primitives,
  });
}

/**
 * The loaded Avatar's structure and the breakdown scenarios of `kinds`.
 * `fallbackMaterials` (bindingKey → material of a Simple load of the same
 * file) enables the `mixed` scenarios.
 */
export function planBreakdown(
  avatar: Avatar,
  renderer: THREE.WebGLRenderer,
  kinds: readonly BreakdownKind[],
  fallbackMaterials: ReadonlyMap<string, THREE.Material | THREE.Material[]>,
): { structure: Structure; scenarios: Scenario[]; notes: string[] } {
  const primitives = primitivesOf(avatar);
  const indices = [
    ...new Set(primitives.map((primitive) => primitive.materialIndex)),
  ].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  const byMaterial = (index: number | null) =>
    primitives.filter((primitive) => primitive.materialIndex === index);
  const materials: MaterialSummary[] = indices.map((index) => {
    const members = byMaterial(index);
    return {
      index,
      kind: kindOf(members[0]!.material),
      blendState: blendStateOf(members[0]!.material),
      prepassBlocker: Array.isArray(members[0]!.mesh.material)
        ? "several_materials"
        : depthPrepassBlocker(members[0]!.material),
      features: lilToonFeatures(members[0]!.material),
      primitives: members.length,
      triangles: sum(members.map((member) => member.triangles)),
      morphTargets: Math.max(...members.map((member) => member.morphTargets)),
      parts: [...new Set(members.flatMap((member) => member.parts))],
    };
  });
  const layers = layersOf(avatar, primitives);
  const meshByKey = new Map(
    primitives.map((primitive) => [primitive.bindingKey, primitive.mesh]),
  );
  const structure: Structure = {
    materials,
    primitives: primitives.length,
    triangles: sum(primitives.map((primitive) => primitive.triangles)),
    layers: layers.map((layer) => ({
      id: layer.id,
      label: layer.label,
      primitives: layer.bindings.length,
      regions: layer.regions.length,
      shared: layer.shared.length,
    })),
  };

  const name = (index: number | null) =>
    index === null ? "unassigned material" : `material #${index}`;
  const lilToonMaterials = uniqueLilToonMaterials(primitives);
  const notes: string[] = [];
  const scenarios: Scenario[] = [];

  if (kinds.includes("materials")) {
    for (const index of indices) {
      const members = byMaterial(index).map((primitive) => primitive.mesh);
      const others = primitives
        .filter((primitive) => primitive.materialIndex !== index)
        .map((primitive) => primitive.mesh);
      scenarios.push(
        {
          id: `material:${index}:hidden`,
          group: "materials",
          label: `${name(index)} hidden`,
          apply: () => hide(members),
        },
        {
          id: `material:${index}:alone`,
          group: "materials",
          label: `${name(index)} alone`,
          apply: () => hide(others),
        },
      );
    }
  }

  if (kinds.includes("features")) {
    if (lilToonMaterials.length === 0)
      notes.push("features: the Avatar draws no lilToon materials");
    scenarios.push(...featureScenarios(primitives, avatar, renderer));
  }

  if (kinds.includes("layers")) {
    const hider = new PrimitiveRegionHider();
    for (const layer of layers) {
      const meshes = layer.bindings.flatMap((bindingKey) => {
        const mesh = meshByKey.get(bindingKey);
        return mesh ? [mesh] : [];
      });
      const detail = [
        `${meshes.length} primitives`,
        ...(layer.regions.length ? [`${layer.regions.length} regions`] : []),
        ...(layer.shared.length
          ? [`${layer.shared.length} shared with other parts`]
          : []),
      ].join(", ");
      scenarios.push({
        id: `layer:${layer.id}`,
        group: "layers",
        label: `${layer.label} hidden (${detail})`,
        apply: () => {
          const show = hide(meshes);
          const source = `bench:${layer.id}`;
          for (const region of layer.regions) {
            const mesh = meshByKey.get(region.bindingKey);
            if (mesh) hider.hide(source, mesh.geometry, region.triangles);
          }
          return () => {
            hider.release(source);
            show();
          };
        },
      });
    }
  }

  if (kinds.includes("mixed")) {
    const swappable = primitives.filter(
      (primitive) =>
        asLilToon(primitive.material) &&
        fallbackMaterials.has(primitive.bindingKey),
    );
    if (swappable.length === 0)
      notes.push(
        "mixed: no lilToon primitive has a fallback material to swap in",
      );
    const swap = (members: readonly Primitive[]) => () => {
      const before = members.map((member) => member.mesh.material);
      for (const member of members)
        member.mesh.material = fallbackMaterials.get(member.bindingKey)!;
      return () =>
        members.forEach((member, index) => {
          member.mesh.material = before[index]!;
        });
    };
    const swappableIndices = [
      ...new Set(swappable.map((primitive) => primitive.materialIndex)),
    ];
    for (const index of swappableIndices) {
      const members = swappable.filter(
        (primitive) => primitive.materialIndex === index,
      );
      const others = swappable.filter(
        (primitive) => primitive.materialIndex !== index,
      );
      scenarios.push({
        id: `mixed:${index}:fallback`,
        group: "mixed",
        label: `${name(index)} as fallback, others lilToon`,
        apply: swap(members),
      });
      if (others.length)
        scenarios.push({
          id: `mixed:${index}:only`,
          group: "mixed",
          label: `only ${name(index)} lilToon, others fallback`,
          apply: swap(others),
        });
    }
    if (swappable.length)
      scenarios.push({
        id: "mixed:all",
        group: "mixed",
        label: "every lilToon material as fallback",
        apply: swap(swappable),
      });
  }

  return { structure, scenarios, notes };
}

/** Each primitive's material by binding key, from a Simple load of the file. */
export function materialsByBinding(
  avatar: Avatar,
): Map<string, THREE.Material | THREE.Material[]> {
  return new Map(
    buildRuntimePrimitiveBindings(avatar).entries.flatMap((entry) => {
      const mesh = entry.object as THREE.Mesh;
      return mesh.isMesh ? [[entry.bindingKey, mesh.material] as const] : [];
    }),
  );
}
