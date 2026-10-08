import type { AvatarEffectDefinitionV2 } from "@animama/runtime-contracts/api-types";
import { zAvatarEffectDefinitionV2 } from "@animama/runtime-contracts/validators";

import { DEFAULT_AVATAR_VFX_ANIMATION_CONFIG } from "./animation";
import { assertAvatarEffectDefinitionSize } from "./effect-image-limits";
import type {
  AvatarVFXAnimationConfig,
  AvatarVFXAppearance,
  AvatarVFXAttachmentEntry,
  AvatarVFXCatalogEntry,
  AvatarVFXFlipbook,
  AvatarVFXHoverPlacement,
  AvatarVFXKeyframes,
  AvatarVFXParsedEntry,
  AvatarVFXRegion,
  AvatarVFXSoundConfig,
  AvatarVFXTargetRole,
  AvatarVFXTransform,
} from "./types";

export const AVATAR_EFFECT_SCHEMA = "animama/avatar-effect/2" as const;
export const LEGACY_AVATAR_EFFECT_SCHEMA = "animama/avatar-effect/1" as const;

/** Command named by every refusal of a `/1` definition. */
export const AVATAR_EFFECT_CONVERSION_HINT =
  "Convert it with `uv run python -m animama.server.content_cli` (Local library) or `uv run python scripts/content/convert_avatar_effects.py --write <folder>`.";

export type AvatarEffectDefinitionErrorCode =
  | "avatar_effect_conversion_required"
  | "avatar_effect_definition_invalid";

/** A definition the runtime refuses; `field` is a JSON path below `definition`. */
export class AvatarEffectDefinitionError extends Error {
  readonly code: AvatarEffectDefinitionErrorCode;
  readonly field: string | null;

  constructor(
    code: AvatarEffectDefinitionErrorCode,
    message: string,
    field: string | null = null,
  ) {
    super(message);
    this.name = "AvatarEffectDefinitionError";
    this.code = code;
    this.field = field;
  }
}

/** Display and resource facts that live beside the definition, not in it. */
export type AvatarEffectEntryContext = {
  id: string;
  label: string;
  description: string;
  /** URL of the decoded `art.image`. */
  assetPath: string;
  /** URL of `art.otherEyeImage`, when the definition names one. */
  otherEyeAssetPath?: string;
  sound?: AvatarVFXSoundConfig;
};

const DEGREES_TO_RADIANS = Math.PI / 180;

const BOX_PLACEMENTS: Record<string, AvatarVFXHoverPlacement> = {
  "forehead:left": "forehead-left",
  "forehead:middle": "forehead-middle",
  "forehead:right": "forehead-right",
  "top:left": "top-left",
  "top:middle": "top-middle",
  "top:right": "top-right",
  "top_edge:left_corner": "top-edge-left-corner",
  "top_edge:left": "top-edge-left",
  "top_edge:middle": "top-edge-middle",
  "top_edge:right": "top-edge-right",
  "top_edge:right_corner": "top-edge-right-corner",
};

function invalid(message: string, field: string | null = null): never {
  throw new AvatarEffectDefinitionError(
    "avatar_effect_definition_invalid",
    `Avatar Effect definition is invalid: ${message}`,
    field,
  );
}

/**
 * Validate an `animama/avatar-effect/2` definition with the generated contract
 * and return it typed. Any other schema is refused; `/1` names the conversion.
 */
export function validateAvatarEffectDefinition(
  definition: unknown,
): AvatarEffectDefinitionV2 {
  const schema =
    definition && typeof definition === "object" && !Array.isArray(definition)
      ? (definition as Record<string, unknown>).schema
      : undefined;
  if (schema === LEGACY_AVATAR_EFFECT_SCHEMA) {
    throw new AvatarEffectDefinitionError(
      "avatar_effect_conversion_required",
      `This Avatar Effect uses ${LEGACY_AVATAR_EFFECT_SCHEMA}. ${AVATAR_EFFECT_CONVERSION_HINT}`,
      "definition.schema",
    );
  }
  try {
    assertAvatarEffectDefinitionSize(definition);
  } catch {
    invalid("the definition exceeds the size limit", "definition");
  }
  if (schema !== AVATAR_EFFECT_SCHEMA) {
    invalid(
      `unsupported schema ${JSON.stringify(schema ?? null)}`,
      "definition.schema",
    );
  }
  const parsed = zAvatarEffectDefinitionV2.safeParse(definition);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = ["definition", ...(issue?.path ?? [])]
      .map((part, index) =>
        typeof part === "number"
          ? `[${part}]`
          : index
            ? `.${String(part)}`
            : String(part),
      )
      .join("");
    invalid(
      issue?.message ?? "the definition does not match the contract",
      path,
    );
  }
  return parsed.data as AvatarEffectDefinitionV2;
}

function appearance(definition: AvatarEffectDefinitionV2): AvatarVFXAppearance {
  return {
    opacity: definition.appearance?.opacity ?? 1,
    tint: definition.appearance?.tint ?? null,
    blend: definition.appearance?.blend ?? "normal",
  };
}

function flipbook(
  definition: AvatarEffectDefinitionV2,
): AvatarVFXFlipbook | undefined {
  const value = definition.art.flipbook;
  if (!value) return undefined;
  if (value.frames > value.columns * value.rows) {
    invalid(
      "flipbook frames cannot exceed columns × rows",
      "definition.art.flipbook.frames",
    );
  }
  return {
    columns: value.columns,
    rows: value.rows,
    frames: value.frames,
    fps: value.fps,
    loop: value.loop ?? "loop",
  };
}

function keyframes(
  definition: AvatarEffectDefinitionV2,
): AvatarVFXKeyframes | undefined {
  const value = definition.motion?.keyframes;
  if (!value) return undefined;
  let previous = -Infinity;
  const frames = value.frames.map((frame, index) => {
    if (!(frame.t > previous)) {
      invalid(
        "keyframe times must increase",
        `definition.motion.keyframes.frames[${index}].t`,
      );
    }
    previous = frame.t;
    return {
      t: frame.t,
      ...(frame.opacity != null ? { opacity: frame.opacity } : {}),
      ...(frame.scale != null ? { scale: frame.scale } : {}),
      ...(frame.rotationDeg != null
        ? { rotation: frame.rotationDeg * DEGREES_TO_RADIANS }
        : {}),
      ...(frame.offset
        ? { offset: { x: frame.offset.x ?? 0, y: frame.offset.y ?? 0 } }
        : {}),
    };
  });
  return { loop: value.loop ?? false, frames };
}

/**
 * Map `/2` motion presets to the controller's animation config. A preset is
 * enabled when its object is present; missing values use the preset defaults.
 */
function animationConfig(
  definition: AvatarEffectDefinitionV2,
): AvatarVFXAnimationConfig | undefined {
  const motion = definition.motion;
  if (!motion) return undefined;
  const config: AvatarVFXAnimationConfig = {};
  if (motion.pulse) {
    if (motion.pulse.scaleMin != null)
      config.pulseScaleMin = motion.pulse.scaleMin;
    if (motion.pulse.scaleMax != null)
      config.pulseScaleMax = motion.pulse.scaleMax;
    if (motion.pulse.cyclesPerSecond != null)
      config.pulseCyclesPerSecond = motion.pulse.cyclesPerSecond;
    // An empty preset still enables pulse with its defaults.
    if (
      config.pulseScaleMin === undefined &&
      config.pulseScaleMax === undefined &&
      config.pulseCyclesPerSecond === undefined
    )
      config.pulseCyclesPerSecond =
        DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.pulseCyclesPerSecond;
  }
  if (motion.spin) {
    if (motion.spin.degreesPerSecond != null) {
      config.rotationRadiansPerSecond =
        motion.spin.degreesPerSecond * DEGREES_TO_RADIANS;
    }
    if (motion.spin.amountTurns != null) {
      config.rotationAmountTurns = motion.spin.amountTurns;
    }
    // Any spin field enables spin; an empty preset spins with its defaults.
    config.rotationDirection =
      motion.spin.direction ??
      (config.rotationRadiansPerSecond === undefined &&
      config.rotationAmountTurns === undefined
        ? DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.rotationDirection
        : undefined);
    if (config.rotationDirection === undefined) delete config.rotationDirection;
  }
  if (motion.drift) {
    config.driftPerSecond = {
      x: motion.drift.x ?? 0,
      y: motion.drift.y ?? 0,
    };
  }
  return Object.keys(config).length ? config : undefined;
}

function hideParts(
  definition: AvatarEffectDefinitionV2,
): AvatarVFXTargetRole[] | undefined {
  const parts = definition.faceOptions?.hideParts;
  return parts ? [...parts] : undefined;
}

function optionalFlag<K extends string>(
  key: K,
  value: boolean | null | undefined,
) {
  return value == null ? {} : ({ [key]: value } as Record<K, boolean>);
}

function faceRegion(definition: AvatarEffectDefinitionV2): AvatarVFXRegion {
  const region = definition.region;
  if (region === "body" || region === "sticker" || region === "silhouette") {
    invalid("a face attachment uses a face region", "definition.region");
  }
  return region;
}

/**
 * Normalize a body, sticker or silhouette definition. The schema already ties
 * the region to the attachment and forbids face options and other-eye art.
 */
function attachmentEntry(
  definition: AvatarEffectDefinitionV2,
  context: AvatarEffectEntryContext,
): AvatarVFXAttachmentEntry | null {
  const attachment = definition.attachment;
  if (
    attachment.kind !== "body" &&
    attachment.kind !== "sticker" &&
    attachment.kind !== "silhouette"
  ) {
    return null;
  }
  if (definition.region !== attachment.kind) {
    invalid(
      `a ${attachment.kind} attachment uses the ${attachment.kind} region`,
      "definition.region",
    );
  }
  const animation = animationConfig(definition);
  const frames = flipbook(definition);
  const timeline = keyframes(definition);
  const base = {
    id: context.id,
    label: context.label,
    description: context.description,
    assetPath: context.assetPath,
    appearance: appearance(definition),
    ...(animation ? { animationConfig: animation } : {}),
    ...(context.sound ? { sound: context.sound } : {}),
    ...(frames ? { flipbook: frames } : {}),
    ...(timeline ? { keyframes: timeline } : {}),
  };
  if (attachment.kind === "body") {
    return {
      ...base,
      kind: "body",
      region: "body",
      bone: attachment.bone,
      offset: {
        x: attachment.offset?.x ?? 0,
        y: attachment.offset?.y ?? 0,
        z: attachment.offset?.z ?? 0,
      },
      size: attachment.size ?? 0.2,
      facing: attachment.facing ?? "camera",
      rotation: (attachment.rotationDeg ?? 0) * DEGREES_TO_RADIANS,
    };
  }
  if (attachment.kind === "sticker") {
    return {
      ...base,
      kind: "sticker",
      region: "sticker",
      around: attachment.around ?? "head",
      offset: { x: attachment.offset?.x ?? 0, y: attachment.offset?.y ?? 0 },
      size: attachment.size ?? 0.25,
      rotation: (attachment.rotationDeg ?? 0) * DEGREES_TO_RADIANS,
    };
  }
  return {
    ...base,
    kind: "silhouette",
    region: "silhouette",
    fill: attachment.fill ?? "pattern",
    patternScale: attachment.patternScale ?? 1,
    scroll: { x: attachment.scroll?.x ?? 0, y: attachment.scroll?.y ?? 0 },
  };
}

/**
 * Validate a stored `/2` definition and normalize it into the controller's
 * internal render entry. Throws {@link AvatarEffectDefinitionError}.
 *
 * Face attachments map to the internal `hover`, `face_anchored` and `texture`
 * entries; body, sticker and silhouette attachments keep their own kinds.
 * Rotations become radians.
 */
export function parseAvatarEffectDefinition(
  value: unknown,
  context: AvatarEffectEntryContext,
): AvatarVFXParsedEntry {
  const definition = validateAvatarEffectDefinition(value);
  const attachment = definition.attachment;
  const attached = attachmentEntry(definition, context);
  if (attached) return attached;
  if (attachment.kind !== "face_surface" && attachment.kind !== "face_landmark")
    invalid("unsupported attachment", "definition.attachment.kind");
  if (definition.art.otherEyeImage && !context.otherEyeAssetPath) {
    invalid(
      "the other-eye image is unavailable",
      "definition.art.otherEyeImage",
    );
  }
  const animation = animationConfig(definition);
  const frames = flipbook(definition);
  const timeline = keyframes(definition);
  const base = {
    id: context.id,
    label: context.label,
    description: context.description,
    assetPath: context.assetPath,
    region: faceRegion(definition),
    appearance: appearance(definition),
    ...(animation ? { animationConfig: animation } : {}),
    ...(context.sound ? { sound: context.sound } : {}),
    ...(definition.art.otherEyeImage && context.otherEyeAssetPath
      ? { otherEyeAssetPath: context.otherEyeAssetPath }
      : {}),
    ...(frames ? { flipbook: frames } : {}),
    ...(timeline ? { keyframes: timeline } : {}),
  };
  const options = definition.faceOptions ?? {};

  if (attachment.kind === "face_landmark") {
    const transform: AvatarVFXTransform = {
      offset: {
        x: attachment.offset?.x ?? 0,
        y: attachment.offset?.y ?? 0,
        z: attachment.offset?.z ?? 0,
      },
      scale: { x: attachment.scale?.x ?? 1, y: attachment.scale?.y ?? 1, z: 1 },
      rotation: {
        x: (attachment.rotationDeg?.x ?? 0) * DEGREES_TO_RADIANS,
        y: (attachment.rotationDeg?.y ?? 0) * DEGREES_TO_RADIANS,
        z: (attachment.rotationDeg?.z ?? 0) * DEGREES_TO_RADIANS,
      },
    };
    if (attachment.landmark === "eyes") {
      const parts = hideParts(definition);
      return {
        ...base,
        transform,
        kind: "hover",
        hoverKind: "eye_hover",
        ...optionalFlag("forceBlink", options.forceBlink),
        ...optionalFlag("autoDisableEyeMaterials", options.hideEyeDetails),
        ...optionalFlag("faceCleanup", options.faceCleanup),
        ...optionalFlag("skinBackdrop", options.skinBackdrop),
        ...(parts ? { disableTargetRoles: parts } : {}),
        ...(attachment.side ? { side: attachment.side } : {}),
        ...(attachment.mirror ? { requiresMirror: true } : {}),
      };
    }
    if (attachment.landmark === "mouth") {
      return {
        ...base,
        transform,
        kind: "hover",
        hoverKind: "mouth_hover",
        ...optionalFlag("faceCleanup", options.faceCleanup),
        ...optionalFlag("skinBackdrop", options.skinBackdrop),
      };
    }
    const placement =
      BOX_PLACEMENTS[`${attachment.landmark}:${attachment.position ?? ""}`];
    if (!placement) {
      invalid(
        "this landmark needs a position (corners only on top_edge)",
        "definition.attachment.position",
      );
    }
    return {
      ...base,
      transform,
      kind: "hover",
      hoverKind: "box_hover",
      placement,
    };
  }

  const transform: AvatarVFXTransform = {
    offset: {
      x: attachment.offset?.x ?? 0,
      y: attachment.offset?.y ?? 0,
      z: 0,
    },
    scale: { x: attachment.scale?.x ?? 1, y: attachment.scale?.y ?? 1, z: 1 },
    rotation: {
      x: 0,
      y: 0,
      z: (attachment.rotationDeg ?? 0) * DEGREES_TO_RADIANS,
    },
  };
  const area = attachment.area;
  if (area === "undereye" || area === "blush" || area === "mouth") {
    const pivot = attachment.pivot ? { pivot: attachment.pivot } : {};
    if (area === "mouth") {
      return {
        ...base,
        transform,
        kind: "face_anchored",
        anchor: "mouth",
        ...pivot,
        ...optionalFlag("faceCleanup", options.faceCleanup),
      };
    }
    if (attachment.layout === "span") {
      return {
        ...base,
        transform,
        kind: "face_anchored",
        anchor: area,
        layout: "span",
        ...pivot,
      };
    }
    if (attachment.layout !== "single" || !attachment.side) {
      invalid(
        "a single face decal requires a side",
        "definition.attachment.side",
      );
    }
    return {
      ...base,
      transform,
      kind: "face_anchored",
      anchor: area,
      layout: "single",
      side: attachment.side,
      ...(attachment.mirror ? { requiresMirror: true } : {}),
      ...pivot,
    };
  }
  const parts = hideParts(definition);
  const texture: AvatarVFXCatalogEntry = {
    ...base,
    transform,
    kind: "texture",
    targetRole: attachment.part,
    assetShape:
      area === "full"
        ? "full_face"
        : attachment.layout === "span"
          ? "double_eye"
          : "single_eye",
    applyMode: attachment.mode ?? "overlay",
    ...(parts ? { disableTargetRoles: parts } : {}),
    ...(attachment.layout === "single" && attachment.side
      ? { side: attachment.side }
      : {}),
    ...(attachment.layout === "single" && attachment.mirror
      ? { requiresMirror: true }
      : {}),
  };
  return texture;
}
