/**
 * TEMPORARY (Avatar Effects v2, Phase 4 → deleted in Phase 9).
 *
 * The current Avatar Effect creator still edits a `/1`-shaped editor document.
 * This adapter converts the definition that document produces into
 * `animama/avatar-effect/2` for Save and preview, mirroring the backend
 * converter (`src/backend/animama/app/services/avatar_effect_conversion.py`).
 * Both are tested against the shared golden pairs in
 * `lib/content/fixtures/avatar-effect-conversion.json`. Phase 9 replaces the
 * editor document with one that mirrors `/2` and deletes this file.
 */

import {
  LEGACY_AVATAR_EFFECT_SCHEMA,
  AVATAR_EFFECT_SCHEMA,
} from "../definition";

type Json = Record<string, unknown>;

const BOX_PLACEMENTS: Record<string, [string, string]> = {
  "forehead-left": ["forehead", "left"],
  "forehead-middle": ["forehead", "middle"],
  "forehead-right": ["forehead", "right"],
  "top-left": ["top", "left"],
  "top-middle": ["top", "middle"],
  "top-right": ["top", "right"],
  "top-edge-left-corner": ["top_edge", "left_corner"],
  "top-edge-left": ["top_edge", "left"],
  "top-edge-middle": ["top_edge", "middle"],
  "top-edge-right": ["top_edge", "right"],
  "top-edge-right-corner": ["top_edge", "right_corner"],
};

const TEXTURE_SHAPES: Record<string, [string, string | null]> = {
  single_eye: ["eyes", "single"],
  double_eye: ["eyes", "span"],
  full_face: ["full", null],
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function fail(message: string): never {
  throw new Error(`Avatar Effect settings cannot be saved: ${message}`);
}

/** Match the backend: degrees rounded to 6 decimals, with -0 normalized. */
function degrees(radians: number): number {
  const value = Math.round(((radians * 180) / Math.PI) * 1e6) / 1e6;
  return value === 0 ? 0 : value;
}

function axes(transform: Json, key: string, fallback: number) {
  const raw = object(transform[key]);
  const read = (axis: string) =>
    typeof raw[axis] === "number" ? (raw[axis] as number) : fallback;
  return { x: read("x"), y: read("y"), z: read("z") };
}

function positiveScale(value: number): number {
  if (value === 0) fail("scale must not be zero");
  return Math.abs(value);
}

function differs(values: Record<string, number>, fallback: number): boolean {
  return Object.values(values).some((value) => value !== fallback);
}

function motion(definition: Json): Json | null {
  const raw = object(definition.animationConfig);
  const result: Json = {};
  const pulse: Json = {};
  for (const [source, target] of [
    ["pulseScaleMin", "scaleMin"],
    ["pulseScaleMax", "scaleMax"],
    ["pulseCyclesPerSecond", "cyclesPerSecond"],
  ] as const) {
    if (raw[source] != null) pulse[target] = raw[source];
  }
  if (Object.keys(pulse).length) result.pulse = pulse;
  const spin: Json = {};
  if (typeof raw.rotationRadiansPerSecond === "number")
    spin.degreesPerSecond = degrees(raw.rotationRadiansPerSecond);
  if (raw.rotationAmountTurns != null)
    spin.amountTurns = raw.rotationAmountTurns;
  if (raw.rotationDirection != null) spin.direction = raw.rotationDirection;
  if (Object.keys(spin).length) result.spin = spin;
  const drift = object(raw.driftPerSecond);
  if (drift.x != null || drift.y != null) {
    // /1 filled a missing axis with its preset default; /2 writes both.
    result.drift = { x: drift.x ?? 0.03, y: drift.y ?? 0 };
  }
  return Object.keys(result).length ? result : null;
}

function faceOptions(definition: Json, names: readonly string[]): Json | null {
  const renamed: Record<string, string> = {
    autoDisableEyeMaterials: "hideEyeDetails",
    disableTargetRoles: "hideParts",
  };
  const result: Json = {};
  for (const name of names) {
    const value = definition[name];
    if (value == null) continue;
    result[renamed[name] ?? name] = Array.isArray(value) ? [...value] : value;
  }
  return Object.keys(result).length ? result : null;
}

function landmark(definition: Json, transform: Json): [Json, Json | null] {
  const offset = axes(transform, "offset", 0);
  const scale = axes(transform, "scale", 1);
  const rotation = axes(transform, "rotation", 0);
  const attachment: Json = { kind: "face_landmark" };
  let options: Json | null = null;
  if (definition.hoverKind === "eye_hover") {
    attachment.landmark = "eyes";
    if (definition.side != null) attachment.side = definition.side;
    if (definition.requiresMirror === true) attachment.mirror = true;
    options = faceOptions(definition, [
      "forceBlink",
      "autoDisableEyeMaterials",
      "faceCleanup",
      "skinBackdrop",
      "disableTargetRoles",
    ]);
  } else if (definition.hoverKind === "mouth_hover") {
    attachment.landmark = "mouth";
    options = faceOptions(definition, ["faceCleanup", "skinBackdrop"]);
  } else if (definition.hoverKind === "box_hover") {
    const placement = BOX_PLACEMENTS[String(definition.placement)];
    if (!placement) fail("unsupported hover placement");
    [attachment.landmark, attachment.position] = placement;
  } else {
    fail("unsupported hover kind");
  }
  if (differs(offset, 0)) attachment.offset = offset;
  const planar = { x: positiveScale(scale.x), y: positiveScale(scale.y) };
  if (differs(planar, 1)) attachment.scale = planar;
  const turned = {
    x: degrees(rotation.x),
    y: degrees(rotation.y),
    z: degrees(rotation.z),
  };
  if (differs(turned, 0)) attachment.rotationDeg = turned;
  return [attachment, options];
}

function surface(definition: Json, transform: Json): [Json, Json | null] {
  const offset = axes(transform, "offset", 0);
  const scale = axes(transform, "scale", 1);
  const rotation = axes(transform, "rotation", 0);
  const attachment: Json = { kind: "face_surface" };
  let options: Json | null = null;
  let layout: string | null;
  if (definition.kind === "face_anchored") {
    const anchor = String(definition.anchor);
    Object.assign(attachment, { part: "face_skin", area: anchor });
    layout = anchor === "mouth" ? null : String(definition.layout);
    if (layout) attachment.layout = layout;
    options =
      anchor === "mouth" ? faceOptions(definition, ["faceCleanup"]) : null;
  } else {
    const shape = TEXTURE_SHAPES[String(definition.assetShape)];
    if (!shape) fail("unsupported texture shape");
    const [area, textureLayout] = shape;
    layout = textureLayout;
    Object.assign(attachment, { part: definition.targetRole, area });
    if (layout) attachment.layout = layout;
    if (definition.applyMode === "replace") attachment.mode = "replace";
    else if (definition.applyMode !== "overlay")
      fail("unsupported texture application");
    options = faceOptions(definition, ["disableTargetRoles"]);
  }
  if (layout === "single") {
    if (definition.side != null) attachment.side = definition.side;
    if (attachment.side != null && definition.requiresMirror === true)
      attachment.mirror = true;
  }
  if (definition.kind === "face_anchored" && definition.pivot != null)
    attachment.pivot = definition.pivot;
  const planarOffset = { x: offset.x, y: offset.y };
  if (differs(planarOffset, 0)) attachment.offset = planarOffset;
  const planar = { x: positiveScale(scale.x), y: positiveScale(scale.y) };
  if (differs(planar, 1)) attachment.scale = planar;
  const turned = degrees(rotation.z);
  if (turned !== 0) attachment.rotationDeg = turned;
  return [attachment, options];
}

/**
 * Convert a `/1`-shaped definition to `/2`; a `/2` input is returned as a copy.
 * Throws when the settings cannot be expressed (for example a zero scale).
 */
export function legacyAvatarEffectDefinitionToV2(value: unknown): Json {
  const definition = object(value);
  if (definition.schema === AVATAR_EFFECT_SCHEMA)
    return structuredClone(definition);
  if (definition.schema !== LEGACY_AVATAR_EFFECT_SCHEMA)
    fail("unsupported definition schema");
  const transform = object(definition.transform);
  const [attachment, options] =
    definition.kind === "hover"
      ? landmark(definition, transform)
      : definition.kind === "face_anchored" || definition.kind === "texture"
        ? surface(definition, transform)
        : fail("unsupported Avatar Effect kind");
  const converted: Json = {
    schema: AVATAR_EFFECT_SCHEMA,
    region: definition.region,
    attachment,
    art: { image: definition.image },
  };
  const animation = motion(definition);
  if (animation) converted.motion = animation;
  if (options) converted.faceOptions = options;
  if (definition.soundAlias != null)
    converted.soundAlias = definition.soundAlias;
  return converted;
}
