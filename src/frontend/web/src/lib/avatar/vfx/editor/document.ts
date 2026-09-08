import type { PyContentDependency } from "@/lib/content/catalogTypes";
import { parseAvatarVFXCatalogEntry } from "@/lib/avatar/vfx/catalog";
import type {
  AvatarVFXAnimationConfig,
  AvatarVFXCatalogEntry,
} from "@/lib/avatar/vfx/types";
import { createDefaultAvatarEffectDocument } from "./defaults";
import {
  AVATAR_EFFECT_EDITOR_SCHEMA,
  type AvatarEffectEditorAction,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorExport,
  type AvatarEffectEditorImage,
  type AvatarEffectValidationIssue,
} from "./types";

export function avatarEffectEditorReducer(
  state: AvatarEffectEditorDocument,
  action: AvatarEffectEditorAction,
): AvatarEffectEditorDocument {
  if (action.type === "replace")
    return cloneAvatarEffectDocument(action.document);
  if (action.type === "set-kind") {
    return {
      ...state,
      kind: action.kind,
      region:
        action.kind === "hover"
          ? "eyes"
          : action.kind === "face_anchored"
            ? "undereye"
            : "full_face",
    };
  }
  if (action.type === "patch") return { ...state, ...action.patch };
  if (action.type === "patch-hover")
    return { ...state, hover: { ...state.hover, ...action.patch } };
  if (action.type === "patch-face")
    return { ...state, face: { ...state.face, ...action.patch } };
  return { ...state, texture: { ...state.texture, ...action.patch } };
}

export function cloneAvatarEffectDocument(
  document: AvatarEffectEditorDocument,
): AvatarEffectEditorDocument {
  return structuredClone(document);
}

export function canonicalAvatarEffectImageName(filename: string): string {
  const basename = filename.replaceAll("\\", "/").split("/").at(-1) ?? "effect";
  const stem =
    basename
      .replace(/\.[^.]+$/, "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "effect";
  const extension = basename.match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
  return `${stem}.${extension === "jpeg" ? "jpg" : (extension ?? "webp")}`;
}

export function avatarEffectDefinition(
  document: AvatarEffectEditorDocument,
): Record<string, unknown> {
  const common: Record<string, unknown> = {
    schema: "animama/avatar-effect/1",
    kind: document.kind,
    region: document.region,
    image: document.image?.logicalName ?? "effect.webp",
    transform: structuredClone(document.transform),
    ...(document.animationConfig
      ? { animationConfig: structuredClone(document.animationConfig) }
      : {}),
    ...(document.lifetime
      ? { lifetime: structuredClone(document.lifetime) }
      : {}),
    ...(document.sound ? { soundAlias: document.sound.alias } : {}),
  };
  if (document.kind === "hover") {
    const settings = document.hover;
    return {
      ...common,
      hoverKind: settings.hoverKind,
      ...(settings.hoverKind === "box_hover"
        ? { placement: settings.placement }
        : {}),
      ...(settings.hoverKind === "eye_hover" && settings.side
        ? { side: settings.side }
        : {}),
      ...(settings.hoverKind === "eye_hover"
        ? { requiresMirror: settings.requiresMirror }
        : {}),
      ...(settings.hoverKind !== "box_hover"
        ? { skinBackdrop: settings.skinBackdrop }
        : {}),
    };
  }
  if (document.kind === "face_anchored") {
    const settings = document.face;
    return {
      ...common,
      anchor: settings.anchor,
      pivot: settings.pivot,
      ...(settings.anchor !== "mouth"
        ? {
            layout: settings.layout,
            ...(settings.layout === "single"
              ? {
                  side: settings.side,
                  requiresMirror: settings.requiresMirror,
                }
              : {}),
          }
        : {}),
    };
  }
  const settings = document.texture;
  return {
    ...common,
    targetRole: settings.targetRole,
    assetShape: settings.assetShape,
    applyMode: settings.applyMode,
    ...(settings.side ? { side: settings.side } : {}),
    requiresMirror: settings.requiresMirror,
  };
}

export function avatarEffectRuntimeEntry(
  document: AvatarEffectEditorDocument,
  imageUrl: string,
): AvatarVFXCatalogEntry {
  const definition = avatarEffectDefinition(document);
  return parseAvatarVFXCatalogEntry({
    ...definition,
    id: "avatar-effect-editor-preview",
    label: document.name || "Avatar Effect preview",
    description:
      document.description.trim() ||
      `${document.name.trim() || "Custom Avatar Effect"} preview.`,
    assetPath: imageUrl,
    ...(document.sound ? { sound: { onApply: document.sound.alias } } : {}),
  });
}

export function avatarEffectDependencies(
  document: AvatarEffectEditorDocument,
): PyContentDependency[] {
  return document.sound
    ? [
        {
          alias: document.sound.alias,
          content_type: "sound_effect",
          source: document.sound.source,
          config: {},
        },
      ]
    : [];
}

export function validateAvatarEffectDocument(
  document: AvatarEffectEditorDocument,
  options: { imageBytesAvailable: boolean; modelCompatible?: boolean | null },
): AvatarEffectValidationIssue[] {
  const issues: AvatarEffectValidationIssue[] = [];
  if (!document.name.trim() || document.name.trim().length > 120) {
    issues.push({
      field: "name",
      severity: "error",
      message: "Give the Avatar Effect a name between 1 and 120 characters.",
    });
  }
  if (!document.image) {
    issues.push({
      field: "image",
      severity: "error",
      message: "Choose one PNG, JPEG, or WebP image.",
    });
  } else if (!options.imageBytesAvailable) {
    issues.push({
      field: "image",
      severity: "error",
      message: "Reselect the image so its bytes can be saved.",
    });
  }
  for (const [group, values] of Object.entries(document.transform)) {
    for (const [axis, value] of Object.entries(values)) {
      const bounds =
        group === "offset"
          ? [-10, 10]
          : group === "scale"
            ? [0.001, 20]
            : [-360, 360];
      if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1])
        issues.push({
          field: `transform.${group}.${axis}`,
          severity: "error",
          message: `${group} ${axis.toUpperCase()} must be between ${bounds[0]} and ${bounds[1]}.`,
        });
    }
  }
  if (
    document.lifetime?.kind === "duration" &&
    (!Number.isFinite(document.lifetime.runEndBufferSec) ||
      document.lifetime.runEndBufferSec < 0 ||
      document.lifetime.runEndBufferSec > 30)
  ) {
    issues.push({
      field: "lifetime",
      severity: "error",
      message: "Duration must be between 0 and 30 seconds.",
    });
  }
  if (
    document.lifetime?.kind === "turns" &&
    (!Number.isInteger(document.lifetime.turns) ||
      document.lifetime.turns < 1 ||
      document.lifetime.turns > 8)
  ) {
    issues.push({
      field: "lifetime",
      severity: "error",
      message: "Conversation lifetime must be between 1 and 8 whole turns.",
    });
  }
  if (document.sound && !isExactContentSource(document.sound.source)) {
    issues.push({
      field: "sound",
      severity: "error",
      message:
        "Reselect the Sound Effect so exact catalog content can be saved.",
    });
  }
  try {
    avatarEffectRuntimeEntry(document, "blob:editor-validation");
  } catch (error) {
    issues.push({
      field: "definition",
      severity: "error",
      message:
        error instanceof Error
          ? error.message
          : "The selected kind has incompatible placement settings.",
    });
  }
  if (options.modelCompatible === false) {
    issues.push({
      field: "previewAvatar",
      severity: "warning",
      message:
        "This effect is valid, but the selected Avatar does not expose the required live binding or face anchor.",
    });
  }
  return issues;
}

export function avatarEffectDocumentFingerprint(
  document: AvatarEffectEditorDocument,
): string {
  return JSON.stringify(canonicalJson(document));
}

export function buildAvatarEffectEditorExport(
  document: AvatarEffectEditorDocument,
): AvatarEffectEditorExport {
  return {
    schema: AVATAR_EFFECT_EDITOR_SCHEMA,
    document: cloneAvatarEffectDocument(document),
  };
}

export function parseAvatarEffectEditorExport(
  value: unknown,
): AvatarEffectEditorDocument {
  const record = object(value);
  const raw = object(record?.document);
  if (record?.schema !== AVATAR_EFFECT_EDITOR_SCHEMA || !raw)
    throw new Error("This is not an Animama Avatar Effect editor document.");
  const defaults = createDefaultAvatarEffectDocument();
  const document = {
    ...defaults,
    ...raw,
    schema: AVATAR_EFFECT_EDITOR_SCHEMA,
    transform: object(raw.transform) as AvatarEffectEditorDocument["transform"],
    hover: { ...defaults.hover, ...object(raw.hover) },
    face: { ...defaults.face, ...object(raw.face) },
    texture: { ...defaults.texture, ...object(raw.texture) },
    image: raw.image ? (object(raw.image) as AvatarEffectEditorImage) : null,
    sound: raw.sound
      ? (object(raw.sound) as AvatarEffectEditorDocument["sound"])
      : null,
  } as AvatarEffectEditorDocument;
  avatarEffectRuntimeEntry(document, "blob:editor-import");
  return document;
}

export function createAvatarEffectDocumentFromDefinition(args: {
  name: string;
  description: string;
  definition: unknown;
  image: AvatarEffectEditorImage;
  sound: AvatarEffectEditorDocument["sound"];
}): AvatarEffectEditorDocument {
  const raw = object(args.definition);
  if (!raw) throw new Error("The Avatar Effect definition is unavailable.");
  const parsed = parseAvatarVFXCatalogEntry({
    ...raw,
    id: "avatar-effect-editor-hydration",
    label: args.name,
    description: args.description,
    assetPath: "blob:avatar-effect-hydration",
  });
  const document = createDefaultAvatarEffectDocument();
  document.name = args.name;
  document.description = args.description;
  document.kind = parsed.kind;
  document.region = parsed.region;
  document.transform = structuredClone(parsed.transform);
  document.animationConfig = parsed.animationConfig
    ? structuredClone(parsed.animationConfig)
    : null;
  document.lifetime = parsed.lifetime ? structuredClone(parsed.lifetime) : null;
  document.image = args.image;
  document.sound = args.sound;
  if (parsed.kind === "hover") {
    document.hover = {
      hoverKind: parsed.hoverKind,
      placement:
        parsed.hoverKind === "box_hover" ? parsed.placement : "forehead-middle",
      side: "side" in parsed ? (parsed.side ?? null) : null,
      requiresMirror:
        "requiresMirror" in parsed ? Boolean(parsed.requiresMirror) : false,
      skinBackdrop:
        "skinBackdrop" in parsed ? Boolean(parsed.skinBackdrop) : false,
    };
  } else if (parsed.kind === "face_anchored") {
    document.face = {
      anchor: parsed.anchor,
      layout: parsed.anchor === "mouth" ? "single" : parsed.layout,
      pivot: parsed.pivot ?? "center",
      side: "side" in parsed ? (parsed.side ?? "left") : "left",
      requiresMirror:
        "requiresMirror" in parsed ? Boolean(parsed.requiresMirror) : false,
    };
  } else {
    document.texture = {
      targetRole: parsed.targetRole,
      assetShape: parsed.assetShape,
      applyMode: parsed.applyMode,
      side: parsed.side ?? null,
      requiresMirror: Boolean(parsed.requiresMirror),
    };
  }
  return document;
}

export function animationConfigForPreset(
  preset: "none" | "pulse" | "spin" | "drift" | "pulse_spin",
): AvatarVFXAnimationConfig | null {
  if (preset === "none") return null;
  return {
    ...(preset === "pulse" || preset === "pulse_spin"
      ? { pulseScaleMin: 0.9, pulseScaleMax: 1.1, pulseCyclesPerSecond: 1.5 }
      : {}),
    ...(preset === "spin" || preset === "pulse_spin"
      ? {
          rotationAmountTurns: 1,
          rotationRadiansPerSecond: 2,
          rotationDirection: "clockwise" as const,
        }
      : {}),
    ...(preset === "drift" ? { driftPerSecond: { x: 0, y: 0.08 } } : {}),
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

function isExactContentSource(value: unknown): boolean {
  const source = object(value);
  if (source?.type === "catalog")
    return (
      typeof source.catalog_item_id === "string" &&
      source.catalog_item_id.length > 0
    );
  return (
    source?.type === "builtin" &&
    typeof source.content_id === "string" &&
    source.content_id.length > 0 &&
    Number.isInteger(source.version) &&
    Number(source.version) > 0
  );
}
