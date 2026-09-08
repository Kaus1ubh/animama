import {
  EMOTION_MAX_VALUE,
  EMOTION_MIN_VALUE,
  isTrackedEmotion,
  type EmotionValue,
} from "@/lib/emotion";
import rawCatalog from "@/assets/effects/vfx/catalog.json";

import type {
  AvatarBoxHoverVFXEntry,
  AvatarEyeHoverVFXEntry,
  AvatarFaceAnchoredMouthVFXEntry,
  AvatarFaceAnchoredSingleDecalVFXEntry,
  AvatarFaceAnchoredSpanDecalVFXEntry,
  AvatarMouthHoverVFXEntry,
  AvatarTextureVFXEntry,
  AvatarVFXAnimationConfig,
  AvatarVFXApplyMode,
  AvatarVFXAssetShape,
  AvatarVFXCatalogEntry,
  AvatarVFXHoverKind,
  AvatarVFXHoverPlacement,
  AvatarVFXKind,
  AvatarVFXLifetime,
  AvatarVFXRegion,
  AvatarVFXRotationDirection,
  AvatarVFXSide,
  AvatarVFXSoundConfig,
  AvatarVFXTargetRole,
  AvatarVFXTextureAnchor,
  AvatarVFXTextureLayout,
  AvatarVFXTexturePivot,
  AvatarVFXTransform,
} from "./types";
import {
  AVATAR_VFX_APPLY_MODES,
  AVATAR_VFX_ASSET_SHAPES,
  AVATAR_VFX_HOVER_KINDS,
  AVATAR_VFX_HOVER_PLACEMENTS,
  AVATAR_VFX_KINDS,
  AVATAR_VFX_LIFETIME_KINDS,
  AVATAR_VFX_ROTATION_DIRECTIONS,
  AVATAR_VFX_SIDES,
  AVATAR_VFX_TARGET_ROLES,
  AVATAR_VFX_TEXTURE_ANCHORS,
  AVATAR_VFX_TEXTURE_LAYOUTS,
  AVATAR_VFX_TEXTURE_PIVOTS,
  DEFAULT_AVATAR_VFX_DURATION_LIFETIME,
  isAvatarVFXRegion,
} from "./types";

type RawCatalogEntry = Record<string, unknown>;

function createAllowedValueSet<T extends string>(
  values: readonly T[],
): Set<string> {
  return new Set<string>(values);
}

const VFX_KIND_SET = createAllowedValueSet(AVATAR_VFX_KINDS);
const VFX_TARGET_ROLE_SET = createAllowedValueSet(AVATAR_VFX_TARGET_ROLES);
const VFX_ASSET_SHAPE_SET = createAllowedValueSet(AVATAR_VFX_ASSET_SHAPES);
const VFX_APPLY_MODE_SET = createAllowedValueSet(AVATAR_VFX_APPLY_MODES);
const VFX_HOVER_KIND_SET = createAllowedValueSet(AVATAR_VFX_HOVER_KINDS);
const VFX_TEXTURE_ANCHOR_SET = createAllowedValueSet(
  AVATAR_VFX_TEXTURE_ANCHORS,
);
const VFX_TEXTURE_LAYOUT_SET = createAllowedValueSet(
  AVATAR_VFX_TEXTURE_LAYOUTS,
);
const VFX_TEXTURE_PIVOT_SET = createAllowedValueSet(AVATAR_VFX_TEXTURE_PIVOTS);
const VFX_SIDE_SET = createAllowedValueSet(AVATAR_VFX_SIDES);
const VFX_HOVER_PLACEMENT_SET = createAllowedValueSet(
  AVATAR_VFX_HOVER_PLACEMENTS,
);
const VFX_ROTATION_DIRECTION_SET = createAllowedValueSet(
  AVATAR_VFX_ROTATION_DIRECTIONS,
);
const VFX_LIFETIME_KIND_SET = createAllowedValueSet(AVATAR_VFX_LIFETIME_KINDS);

function isRecord(value: unknown): value is RawCatalogEntry {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createError(context: string, message: string): Error {
  return new Error(`[AvatarVFXCatalog] ${context}: ${message}`);
}

function readString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string") {
    throw createError(context, `"${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw createError(context, `"${field}" must not be empty.`);
  }
  return trimmed;
}

function readFiniteNumber(
  value: unknown,
  field: string,
  context: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError(context, `"${field}" must be a finite number.`);
  }
  return value;
}

function readOptionalBoolean(
  value: unknown,
  field: string,
  context: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw createError(context, `"${field}" must be a boolean.`);
  }
  return value;
}

function readEnumValue<T extends string>(
  value: unknown,
  field: string,
  context: string,
  allowed: Set<string>,
): T {
  const parsed = readString(value, field, context);
  if (!allowed.has(parsed)) {
    throw createError(context, `"${field}" has unsupported value "${parsed}".`);
  }
  return parsed as T;
}

function readOptionalEnumValue<T extends string>(
  value: unknown,
  field: string,
  context: string,
  allowed: Set<string>,
): T | undefined {
  if (value === undefined) return undefined;
  return readEnumValue<T>(value, field, context, allowed);
}

function readOptionalEnumArray<T extends string>(
  value: unknown,
  field: string,
  context: string,
  allowed: Set<string>,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw createError(context, `"${field}" must be an array when provided.`);
  }
  return value.map((item, index) =>
    readEnumValue<T>(item, `${field}[${index}]`, context, allowed),
  );
}

export function createDefaultVFXTransform(): AvatarVFXTransform {
  return {
    offset: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function cloneTransform(value: AvatarVFXTransform): AvatarVFXTransform {
  return {
    offset: { ...value.offset },
    scale: { ...value.scale },
    rotation: { ...value.rotation },
  };
}

function cloneLifetime(value: AvatarVFXLifetime): AvatarVFXLifetime {
  if (value.kind === "duration") {
    return {
      kind: "duration",
      runEndBufferSec: value.runEndBufferSec,
    };
  }
  return {
    kind: "turns",
    turns: value.turns,
  };
}

function normalizeTransform(
  value: unknown,
  context: string,
): AvatarVFXTransform {
  if (value === undefined) {
    return createDefaultVFXTransform();
  }
  if (!isRecord(value)) {
    throw createError(context, `"transform" must be an object when provided.`);
  }

  const base = createDefaultVFXTransform();
  const next = cloneTransform(base);

  const parseAxisTriple = (
    axisValue: unknown,
    field: keyof AvatarVFXTransform,
  ) => {
    if (axisValue === undefined) return;
    if (!isRecord(axisValue)) {
      throw createError(context, `"transform.${field}" must be an object.`);
    }
    next[field] = {
      x:
        axisValue.x === undefined
          ? base[field].x
          : readFiniteNumber(axisValue.x, `transform.${field}.x`, context),
      y:
        axisValue.y === undefined
          ? base[field].y
          : readFiniteNumber(axisValue.y, `transform.${field}.y`, context),
      z:
        axisValue.z === undefined
          ? base[field].z
          : readFiniteNumber(axisValue.z, `transform.${field}.z`, context),
    };
  };

  parseAxisTriple(value.offset, "offset");
  parseAxisTriple(value.scale, "scale");
  parseAxisTriple(value.rotation, "rotation");

  return next;
}

function normalizeAnimationConfig(
  value: unknown,
  context: string,
): AvatarVFXAnimationConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw createError(
      context,
      `"animationConfig" must be an object when provided.`,
    );
  }

  const driftPerSecondValue = value.driftPerSecond;
  let driftPerSecond: AvatarVFXAnimationConfig["driftPerSecond"] | undefined;
  if (driftPerSecondValue !== undefined) {
    if (!isRecord(driftPerSecondValue)) {
      throw createError(
        context,
        `"animationConfig.driftPerSecond" must be an object.`,
      );
    }
    driftPerSecond = {
      ...(driftPerSecondValue.x !== undefined
        ? {
            x: readFiniteNumber(
              driftPerSecondValue.x,
              "animationConfig.driftPerSecond.x",
              context,
            ),
          }
        : {}),
      ...(driftPerSecondValue.y !== undefined
        ? {
            y: readFiniteNumber(
              driftPerSecondValue.y,
              "animationConfig.driftPerSecond.y",
              context,
            ),
          }
        : {}),
    };
  }

  const next: AvatarVFXAnimationConfig = {
    ...(value.pulseScaleMin !== undefined
      ? {
          pulseScaleMin: readFiniteNumber(
            value.pulseScaleMin,
            "animationConfig.pulseScaleMin",
            context,
          ),
        }
      : {}),
    ...(value.pulseScaleMax !== undefined
      ? {
          pulseScaleMax: readFiniteNumber(
            value.pulseScaleMax,
            "animationConfig.pulseScaleMax",
            context,
          ),
        }
      : {}),
    ...(value.pulseCyclesPerSecond !== undefined
      ? {
          pulseCyclesPerSecond: readFiniteNumber(
            value.pulseCyclesPerSecond,
            "animationConfig.pulseCyclesPerSecond",
            context,
          ),
        }
      : {}),
    ...(value.rotationAmountTurns !== undefined
      ? {
          rotationAmountTurns: readFiniteNumber(
            value.rotationAmountTurns,
            "animationConfig.rotationAmountTurns",
            context,
          ),
        }
      : {}),
    ...(value.rotationRadiansPerSecond !== undefined
      ? {
          rotationRadiansPerSecond: readFiniteNumber(
            value.rotationRadiansPerSecond,
            "animationConfig.rotationRadiansPerSecond",
            context,
          ),
        }
      : {}),
    ...(value.rotationDirection !== undefined
      ? {
          rotationDirection: readEnumValue<AvatarVFXRotationDirection>(
            value.rotationDirection,
            "animationConfig.rotationDirection",
            context,
            VFX_ROTATION_DIRECTION_SET,
          ),
        }
      : {}),
    ...(driftPerSecond ? { driftPerSecond } : {}),
  };

  return Object.keys(next).length > 0 ? next : undefined;
}

function clampEmotionThreshold(value: number): number {
  return Math.max(
    EMOTION_MIN_VALUE,
    Math.min(EMOTION_MAX_VALUE, Math.round(value)),
  );
}

function normalizeEmotions(
  value: unknown,
  context: string,
): EmotionValue[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw createError(context, `"emotions" must be an array when provided.`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw createError(context, `"emotions[${index}]" must be an object.`);
    }
    const emotion = readString(
      item.emotion,
      `emotions[${index}].emotion`,
      context,
    );
    if (!isTrackedEmotion(emotion)) {
      throw createError(
        context,
        `"emotions[${index}].emotion" has unsupported value "${emotion}".`,
      );
    }
    return {
      emotion,
      value: clampEmotionThreshold(
        readFiniteNumber(item.value, `emotions[${index}].value`, context),
      ),
    };
  });
}

function normalizeLifetime(
  value: unknown,
  context: string,
  options: { hasEmotionTags: boolean },
): AvatarVFXLifetime | undefined {
  if (value === undefined) {
    return options.hasEmotionTags
      ? cloneLifetime(DEFAULT_AVATAR_VFX_DURATION_LIFETIME)
      : undefined;
  }
  if (!isRecord(value)) {
    throw createError(context, `"lifetime" must be an object when provided.`);
  }
  const kind = readEnumValue<AvatarVFXLifetime["kind"]>(
    value.kind,
    "lifetime.kind",
    context,
    VFX_LIFETIME_KIND_SET,
  );
  if (kind === "duration") {
    return {
      kind,
      runEndBufferSec: Math.max(
        0,
        readFiniteNumber(
          value.runEndBufferSec,
          "lifetime.runEndBufferSec",
          context,
        ),
      ),
    };
  }
  return {
    kind,
    turns: Math.max(
      0,
      Math.round(readFiniteNumber(value.turns, "lifetime.turns", context)),
    ),
  };
}

type NormalizedBaseEntry = {
  id: string;
  label: string;
  description: string;
  assetPath: string;
  region: AvatarVFXRegion;
  transform: AvatarVFXTransform;
  animationConfig?: AvatarVFXAnimationConfig;
  emotions?: EmotionValue[];
  lifetime?: AvatarVFXLifetime;
  sound?: AvatarVFXSoundConfig;
};

function normalizeSoundConfig(
  value: unknown,
  context: string,
): AvatarVFXSoundConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw createError(context, `"sound" must be an object when provided.`);
  }

  const onApply = value.onApply;
  if (onApply === undefined) {
    return undefined;
  }

  return {
    onApply: readString(onApply, "sound.onApply", context),
  };
}

function normalizeBaseEntry(
  raw: RawCatalogEntry,
  context: string,
): NormalizedBaseEntry {
  const region = readString(raw.region, "region", context);
  if (!isAvatarVFXRegion(region)) {
    throw createError(context, `"region" has unsupported value "${region}".`);
  }

  const emotions = normalizeEmotions(raw.emotions, context);
  const lifetime = normalizeLifetime(raw.lifetime, context, {
    hasEmotionTags: Boolean(emotions && emotions.length > 0),
  });
  const sound = normalizeSoundConfig(raw.sound, context);

  return {
    id: readString(raw.id, "id", context),
    label: readString(raw.label, "label", context),
    description: readString(raw.description, "description", context),
    assetPath: readString(raw.assetPath, "assetPath", context),
    region,
    transform: normalizeTransform(raw.transform, context),
    animationConfig: normalizeAnimationConfig(raw.animationConfig, context),
    ...(emotions ? { emotions } : {}),
    ...(lifetime ? { lifetime } : {}),
    ...(sound ? { sound } : {}),
  };
}

function normalizeHoverEntry(
  raw: RawCatalogEntry,
  context: string,
): AvatarEyeHoverVFXEntry | AvatarMouthHoverVFXEntry | AvatarBoxHoverVFXEntry {
  const base = normalizeBaseEntry(raw, context);
  const hoverKind = readEnumValue<AvatarVFXHoverKind>(
    raw.hoverKind,
    "hoverKind",
    context,
    VFX_HOVER_KIND_SET,
  );

  if (hoverKind === "eye_hover") {
    return {
      ...base,
      kind: "hover",
      hoverKind,
      ...(readOptionalEnumArray<AvatarVFXTargetRole>(
        raw.disableTargetRoles,
        "disableTargetRoles",
        context,
        VFX_TARGET_ROLE_SET,
      )
        ? {
            disableTargetRoles: readOptionalEnumArray<AvatarVFXTargetRole>(
              raw.disableTargetRoles,
              "disableTargetRoles",
              context,
              VFX_TARGET_ROLE_SET,
            ),
          }
        : {}),
      ...(readOptionalEnumValue<AvatarVFXSide>(
        raw.side,
        "side",
        context,
        VFX_SIDE_SET,
      )
        ? {
            side: readOptionalEnumValue<AvatarVFXSide>(
              raw.side,
              "side",
              context,
              VFX_SIDE_SET,
            ),
          }
        : {}),
      ...(raw.requiresMirror !== undefined
        ? {
            requiresMirror: readOptionalBoolean(
              raw.requiresMirror,
              "requiresMirror",
              context,
            ),
          }
        : {}),
      ...(raw.skinBackdrop !== undefined
        ? {
            skinBackdrop: readOptionalBoolean(
              raw.skinBackdrop,
              "skinBackdrop",
              context,
            ),
          }
        : {}),
    };
  }

  if (hoverKind === "mouth_hover") {
    return {
      ...base,
      kind: "hover",
      hoverKind,
      ...(raw.skinBackdrop !== undefined
        ? {
            skinBackdrop: readOptionalBoolean(
              raw.skinBackdrop,
              "skinBackdrop",
              context,
            ),
          }
        : {}),
    };
  }

  return {
    ...base,
    kind: "hover",
    hoverKind,
    placement: readEnumValue<AvatarVFXHoverPlacement>(
      raw.placement,
      "placement",
      context,
      VFX_HOVER_PLACEMENT_SET,
    ),
  };
}

function normalizeFaceAnchoredEntry(
  raw: RawCatalogEntry,
  context: string,
):
  | AvatarFaceAnchoredSingleDecalVFXEntry
  | AvatarFaceAnchoredSpanDecalVFXEntry
  | AvatarFaceAnchoredMouthVFXEntry {
  const base = normalizeBaseEntry(raw, context);
  const anchor = readEnumValue<AvatarVFXTextureAnchor>(
    raw.anchor,
    "anchor",
    context,
    VFX_TEXTURE_ANCHOR_SET,
  );

  if (anchor === "mouth") {
    return {
      ...base,
      kind: "face_anchored",
      anchor,
      ...(readOptionalEnumValue<AvatarVFXTexturePivot>(
        raw.pivot,
        "pivot",
        context,
        VFX_TEXTURE_PIVOT_SET,
      )
        ? {
            pivot: readOptionalEnumValue<AvatarVFXTexturePivot>(
              raw.pivot,
              "pivot",
              context,
              VFX_TEXTURE_PIVOT_SET,
            ),
          }
        : {}),
    };
  }

  const layout = readEnumValue<AvatarVFXTextureLayout>(
    raw.layout,
    "layout",
    context,
    VFX_TEXTURE_LAYOUT_SET,
  );

  if (layout === "span") {
    return {
      ...base,
      kind: "face_anchored",
      anchor,
      layout,
      ...(readOptionalEnumValue<AvatarVFXTexturePivot>(
        raw.pivot,
        "pivot",
        context,
        VFX_TEXTURE_PIVOT_SET,
      )
        ? {
            pivot: readOptionalEnumValue<AvatarVFXTexturePivot>(
              raw.pivot,
              "pivot",
              context,
              VFX_TEXTURE_PIVOT_SET,
            ),
          }
        : {}),
    };
  }

  return {
    ...base,
    kind: "face_anchored",
    anchor,
    layout,
    side: readEnumValue<AvatarVFXSide>(raw.side, "side", context, VFX_SIDE_SET),
    ...(raw.requiresMirror !== undefined
      ? {
          requiresMirror: readOptionalBoolean(
            raw.requiresMirror,
            "requiresMirror",
            context,
          ),
        }
      : {}),
    ...(readOptionalEnumValue<AvatarVFXTexturePivot>(
      raw.pivot,
      "pivot",
      context,
      VFX_TEXTURE_PIVOT_SET,
    )
      ? {
          pivot: readOptionalEnumValue<AvatarVFXTexturePivot>(
            raw.pivot,
            "pivot",
            context,
            VFX_TEXTURE_PIVOT_SET,
          ),
        }
      : {}),
  };
}

function normalizeTextureEntry(
  raw: RawCatalogEntry,
  context: string,
): AvatarTextureVFXEntry {
  const base = normalizeBaseEntry(raw, context);
  return {
    ...base,
    kind: "texture",
    targetRole: readEnumValue<AvatarVFXTargetRole>(
      raw.targetRole,
      "targetRole",
      context,
      VFX_TARGET_ROLE_SET,
    ),
    assetShape: readEnumValue<AvatarVFXAssetShape>(
      raw.assetShape,
      "assetShape",
      context,
      VFX_ASSET_SHAPE_SET,
    ),
    applyMode: readEnumValue<AvatarVFXApplyMode>(
      raw.applyMode,
      "applyMode",
      context,
      VFX_APPLY_MODE_SET,
    ),
    ...(readOptionalEnumArray<AvatarVFXTargetRole>(
      raw.disableTargetRoles,
      "disableTargetRoles",
      context,
      VFX_TARGET_ROLE_SET,
    )
      ? {
          disableTargetRoles: readOptionalEnumArray<AvatarVFXTargetRole>(
            raw.disableTargetRoles,
            "disableTargetRoles",
            context,
            VFX_TARGET_ROLE_SET,
          ),
        }
      : {}),
    ...(readOptionalEnumValue<AvatarVFXSide>(
      raw.side,
      "side",
      context,
      VFX_SIDE_SET,
    )
      ? {
          side: readOptionalEnumValue<AvatarVFXSide>(
            raw.side,
            "side",
            context,
            VFX_SIDE_SET,
          ),
        }
      : {}),
    ...(raw.requiresMirror !== undefined
      ? {
          requiresMirror: readOptionalBoolean(
            raw.requiresMirror,
            "requiresMirror",
            context,
          ),
        }
      : {}),
  };
}

function normalizeCatalogEntry(
  raw: unknown,
  index: number,
): AvatarVFXCatalogEntry {
  const context = `entry #${index}`;
  if (!isRecord(raw)) {
    throw createError(context, "Each catalog entry must be an object.");
  }

  const kind = readEnumValue<AvatarVFXKind>(
    raw.kind,
    "kind",
    context,
    VFX_KIND_SET,
  );
  switch (kind) {
    case "hover":
      return normalizeHoverEntry(raw, context);
    case "face_anchored":
      return normalizeFaceAnchoredEntry(raw, context);
    case "texture":
      return normalizeTextureEntry(raw, context);
    default:
      throw createError(context, `"kind" has unsupported value "${kind}".`);
  }
}

/** Parse one code-shipped or runtime-projected Avatar VFX entry defensively. */
export function parseAvatarVFXCatalogEntry(
  value: unknown,
): AvatarVFXCatalogEntry {
  return normalizeCatalogEntry(value, 0);
}

const RAW_CATALOG = rawCatalog as unknown;

if (!Array.isArray(RAW_CATALOG)) {
  throw createError("root", "Catalog JSON must be an array.");
}

export const AVATAR_VFX_CATALOG: AvatarVFXCatalogEntry[] = RAW_CATALOG.map(
  (entry, index) => normalizeCatalogEntry(entry, index),
);
