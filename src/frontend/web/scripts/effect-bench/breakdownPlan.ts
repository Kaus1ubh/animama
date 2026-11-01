/**
 * What `effects:bench --breakdown` varies, as plain data: the lilToon
 * features it switches off, the shader-variant changes that remove a lilToon
 * pass, and the structural layers of an Avatar it hides. No three.js here, so
 * Node tests cover it without a browser; `breakdown.ts` applies it to a
 * loaded Avatar.
 */

/** A lilToon material's switchable state, as three-liltoon exposes it. */
export type LilToonState = {
  /** three-liltoon's `shaderVariant` (a Unity shader name). */
  shaderVariant: string;
  /** Original lilToon property values (`lilToonProperties`). */
  properties: Readonly<Record<string, unknown>>;
};

/**
 * lilToon features switched off through their `_Use*` properties. Each of
 * these properties is a shader specialization constant in three-liltoon, so
 * 0 compiles that feature's code out instead of skipping it at run time.
 */
export const LILTOON_PROPERTY_FEATURES: readonly {
  id: string;
  label: string;
  properties: readonly string[];
}[] = [
  { id: "shadow", label: "toon shadow", properties: ["_UseShadow"] },
  { id: "rim", label: "rim light", properties: ["_UseRim"] },
  { id: "rim-shade", label: "rim shade", properties: ["_UseRimShade"] },
  {
    id: "matcap",
    label: "matcaps",
    properties: ["_UseMatCap", "_UseMatCap2nd"],
  },
  {
    id: "emission",
    label: "emission",
    properties: ["_UseEmission", "_UseEmission2nd"],
  },
  {
    id: "normal-map",
    label: "normal maps",
    properties: ["_UseBumpMap", "_UseBump2ndMap"],
  },
  { id: "reflection", label: "reflection", properties: ["_UseReflection"] },
  { id: "backlight", label: "backlight", properties: ["_UseBacklight"] },
  { id: "anisotropy", label: "anisotropy", properties: ["_UseAnisotropy"] },
  { id: "glitter", label: "glitter", properties: ["_UseGlitter"] },
  {
    id: "parallax",
    label: "parallax",
    properties: ["_UseParallax", "_UsePOM"],
  },
  {
    id: "color-layers",
    label: "2nd and 3rd main colour layers",
    properties: ["_UseMain2ndTex", "_UseMain3rdTex"],
  },
  { id: "dither", label: "dither", properties: ["_UseDither"] },
];

const OUTLINE = "Outline";
const TRANSPARENT_VARIANT =
  /^Hidden\/lilToon(?:OnePass|TwoPass)?Transparent(Outline)?$/;

/**
 * lilToon passes removed by selecting another shader variant. `without`
 * returns the variant without that pass, or null when the variant has none.
 */
export const LILTOON_VARIANT_FEATURES: readonly {
  id: string;
  label: string;
  without: (variant: string) => string | null;
}[] = [
  {
    id: "outline",
    label: "outline pass",
    without: (variant) =>
      variant === `Hidden/lilToon${OUTLINE}`
        ? "lilToon"
        : variant.endsWith(OUTLINE)
          ? variant.slice(0, -OUTLINE.length)
          : null,
  },
  {
    id: "two-pass",
    label: "two-pass transparency pre-pass",
    without: (variant) =>
      variant.startsWith("Hidden/lilToonTwoPassTransparent")
        ? variant.replace("TwoPassTransparent", "Transparent")
        : null,
  },
  {
    id: "blending",
    label: "alpha blending (drawn as cutout)",
    without: (variant) => {
      const match = TRANSPARENT_VARIANT.exec(variant);
      return match ? `Hidden/lilToonCutout${match[1] ?? ""}` : null;
    },
  },
  {
    id: "alpha-test",
    label: "alpha test (cutout drawn as opaque)",
    without: (variant) =>
      variant === "Hidden/lilToonCutout"
        ? "lilToon"
        : variant === `Hidden/lilToonCutout${OUTLINE}`
          ? `Hidden/lilToon${OUTLINE}`
          : null,
  },
];

/** The features of the "every feature off" scenario: blending stays. */
export const ALL_FEATURES_OFF = [
  ...LILTOON_PROPERTY_FEATURES.map((feature) => feature.id),
  "outline",
] as const;

/** A lilToon property value's first component, as three-liltoon reads it. */
export function firstComponent(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return Number(value[0] ?? 0);
  if (value && typeof value === "object" && "x" in value)
    return Number((value as { x: unknown }).x);
  return Number(value ?? 0);
}

/** The ids of the features a lilToon material uses (property and pass features). */
export function lilToonFeaturesOf(state: LilToonState): string[] {
  const used = LILTOON_PROPERTY_FEATURES.filter((feature) =>
    feature.properties.some(
      (name) => firstComponent(state.properties[name]) !== 0,
    ),
  ).map((feature) => feature.id);
  for (const feature of LILTOON_VARIANT_FEATURES)
    if (feature.without(state.shaderVariant) !== null) used.push(feature.id);
  return used;
}

/** The face part roles the runtime detects (`AVATAR_FACE_PART_ROLES`). */
export type FaceRole =
  | "face_skin"
  | "eye_left"
  | "eye_right"
  | "eye_highlight"
  | "eyeline"
  | "eyelash"
  | "hair";

/** Triangles of one primitive (numbers in its index buffer). */
export type Region = { bindingKey: string; triangles: readonly number[] };

/** How a primitive's material blends. */
export type Blend = "opaque" | "cutout" | "transparent";

/** What layer detection reads from a loaded Avatar. */
export type LayerSource = {
  /** Detected face parts by role; a missing role has no bindings. */
  roles: Partial<
    Record<
      FaceRole,
      { bindings: readonly string[]; regions?: readonly Region[] }
    >
  >;
  /** Eye-bone primitives classified as eye whites (eyeball domes). */
  eyeWhites: readonly string[];
  /** Every drawn primitive with its material's blending. */
  primitives: readonly { bindingKey: string; blend: Blend }[];
};

/** A set of primitives and triangle regions hidden together. */
export type Layer = {
  id: string;
  label: string;
  /** Whole primitives to hide. */
  bindings: string[];
  /** Triangle regions inside primitives that also draw other parts. */
  regions: Region[];
  /**
   * Hidden primitives that also hold a part outside this layer, so hiding
   * them removes more than the layer (for example eye highlights drawn in
   * the iris primitive).
   */
  shared: string[];
};

type LayerDefinition = {
  id: string;
  label: string;
  roles?: readonly FaceRole[];
  eyeWhites?: boolean;
  blend?: Blend;
  /** Primitives in no face part and not eye whites. */
  rest?: boolean;
};

/**
 * Layers by structure: face parts as detection finds them (by skinning,
 * blink movement and placement, not names), eye-bone eye whites, blending,
 * and everything else.
 */
const LAYER_DEFINITIONS: readonly LayerDefinition[] = [
  {
    id: "eye-stack",
    label: "eye stack (irises, highlights and eye whites)",
    roles: ["eye_left", "eye_right", "eye_highlight"],
    eyeWhites: true,
  },
  { id: "irises", label: "irises", roles: ["eye_left", "eye_right"] },
  { id: "eye-highlights", label: "eye highlights", roles: ["eye_highlight"] },
  {
    id: "eye-whites",
    label: "eye whites (eye-bone primitives)",
    eyeWhites: true,
  },
  { id: "eyelines", label: "eye lines", roles: ["eyeline"] },
  { id: "eyelashes", label: "eyelashes", roles: ["eyelash"] },
  { id: "face-skin", label: "face skin", roles: ["face_skin"] },
  { id: "hair", label: "hair", roles: ["hair"] },
  {
    id: "transparent",
    label: "alpha-blended primitives",
    blend: "transparent",
  },
  { id: "cutout", label: "alpha-tested primitives", blend: "cutout" },
  {
    id: "rest",
    label: "body and clothing (no face part)",
    rest: true,
  },
];

/** The structural layers of an Avatar that hold anything, in a fixed order. */
export function buildLayers(source: LayerSource): Layer[] {
  const owners = new Map<string, Set<string>>();
  const own = (bindingKey: string, owner: string) => {
    const set = owners.get(bindingKey) ?? new Set<string>();
    set.add(owner);
    owners.set(bindingKey, set);
  };
  for (const [role, part] of Object.entries(source.roles)) {
    for (const bindingKey of part?.bindings ?? []) own(bindingKey, role);
    for (const region of part?.regions ?? []) own(region.bindingKey, role);
  }
  for (const bindingKey of source.eyeWhites) own(bindingKey, "eye_white");

  const layers: Layer[] = [];
  for (const definition of LAYER_DEFINITIONS) {
    const members = new Set<string>([
      ...(definition.roles ?? []),
      ...(definition.eyeWhites ? ["eye_white"] : []),
    ]);
    const bindings = new Set<string>();
    const regions: Region[] = [];
    for (const role of definition.roles ?? []) {
      const part = source.roles[role];
      for (const bindingKey of part?.bindings ?? []) bindings.add(bindingKey);
      regions.push(...(part?.regions ?? []));
    }
    if (definition.eyeWhites)
      for (const bindingKey of source.eyeWhites) bindings.add(bindingKey);
    for (const primitive of source.primitives) {
      if (definition.blend && primitive.blend === definition.blend)
        bindings.add(primitive.bindingKey);
      if (definition.rest && !owners.has(primitive.bindingKey))
        bindings.add(primitive.bindingKey);
    }
    // A region inside a primitive the layer hides whole adds nothing.
    const hiddenRegions = regions.filter(
      (region) => !bindings.has(region.bindingKey),
    );
    if (bindings.size === 0 && hiddenRegions.length === 0) continue;
    const shared = [...bindings].filter((bindingKey) =>
      [...(owners.get(bindingKey) ?? [])].some((owner) => !members.has(owner)),
    );
    layers.push({
      id: definition.id,
      label: definition.label,
      bindings: [...bindings],
      regions: hiddenRegions,
      shared: definition.blend || definition.rest ? [] : shared,
    });
  }
  return layers;
}
