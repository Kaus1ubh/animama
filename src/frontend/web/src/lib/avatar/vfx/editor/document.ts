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
  if (action.type === "patch") {
    const next = { ...state, ...action.patch };
    if (action.patch.region !== undefined) next.regionMode = "custom";
    if (next.regionMode === "automatic")
      next.region = suggestedAvatarEffectRegion(next);
    return next;
  }
  const next =
    action.type === "set-kind"
      ? { ...state, kind: action.kind }
      : action.type === "patch-hover"
        ? { ...state, hover: { ...state.hover, ...action.patch } }
        : action.type === "patch-face"
          ? { ...state, face: { ...state.face, ...action.patch } }
          : { ...state, texture: { ...state.texture, ...action.patch } };
  // Automatic placement defaults never replace an explicit region choice.
  if (state.regionMode === "automatic") {
    next.region = suggestedAvatarEffectRegion(next);
  }
  return next;
}

/** Region controls coexistence, independently of the image's geometric placement. */
function suggestedAvatarEffectRegion(document: AvatarEffectEditorDocument) {
  if (document.kind === "hover") {
    return document.hover.hoverKind === "eye_hover"
      ? "eyes"
      : document.hover.hoverKind === "mouth_hover"
        ? "mouth"
        : "emote";
  }
  if (document.kind === "face_anchored") return document.face.anchor;
  return document.texture.targetRole === "face_skin" ? "full_face" : "eyes";
}

export function cloneAvatarEffectDocument(
  document: AvatarEffectEditorDocument,
): AvatarEffectEditorDocument {
  const defaults = createDefaultAvatarEffectDocument();
  return structuredClone({
    ...defaults,
    ...withoutLegacyFields(document),
    regionMode: document.regionMode ?? "custom",
    hover: { ...defaults.hover, ...document.hover },
    face: { ...defaults.face, ...document.face },
    texture: { ...defaults.texture, ...document.texture },
  });
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
        ? {
            requiresMirror: settings.requiresMirror,
            forceBlink: settings.forceBlink,
            autoDisableEyeMaterials: settings.autoDisableEyeMaterials,
            disableTargetRoles: [...settings.disableTargetRoles],
          }
        : {}),
      ...(settings.hoverKind !== "box_hover"
        ? {
            skinBackdrop: settings.skinBackdrop,
            faceCleanup: settings.faceCleanup,
          }
        : {}),
    };
  }
  if (document.kind === "face_anchored") {
    const settings = document.face;
    return {
      ...common,
      anchor: settings.anchor,
      pivot: settings.pivot,
      ...(settings.anchor === "mouth"
        ? { faceCleanup: settings.faceCleanup }
        : {}),
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
    disableTargetRoles: [...settings.disableTargetRoles],
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
  if (document.name.trim().length > 120) {
    issues.push({
      field: "name",
      severity: "error",
      message: "Keep the Avatar Effect name within 120 characters.",
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
    ...withoutLegacyFields(raw),
    schema: AVATAR_EFFECT_EDITOR_SCHEMA,
    regionMode: raw.regionMode ?? "custom",
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
    // Runtime entries require display copy; the authoring description is optional.
    description: args.description.trim() || args.name,
    assetPath: "blob:avatar-effect-hydration",
  });
  const document = createDefaultAvatarEffectDocument();
  document.name = args.name;
  document.description = args.description;
  document.kind = parsed.kind;
  document.region = parsed.region;
  document.regionMode = "custom";
  document.transform = structuredClone(parsed.transform);
  document.animationConfig = parsed.animationConfig
    ? structuredClone(parsed.animationConfig)
    : null;
  document.image = args.image;
  document.sound = args.sound;
  if (parsed.kind === "hover") {
    document.hover = {
      ...document.hover,
      forceBlink: "forceBlink" in parsed ? (parsed.forceBlink ?? true) : true,
      autoDisableEyeMaterials:
        "autoDisableEyeMaterials" in parsed
          ? (parsed.autoDisableEyeMaterials ?? true)
          : true,
      faceCleanup:
        "faceCleanup" in parsed ? (parsed.faceCleanup ?? true) : true,
      disableTargetRoles:
        "disableTargetRoles" in parsed
          ? [...(parsed.disableTargetRoles ?? [])]
          : [],
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
      ...document.face,
      faceCleanup:
        "faceCleanup" in parsed ? (parsed.faceCleanup ?? true) : true,
      anchor: parsed.anchor,
      layout: parsed.anchor === "mouth" ? "single" : parsed.layout,
      pivot: parsed.pivot ?? "center",
      side: "side" in parsed ? (parsed.side ?? "left") : "left",
      requiresMirror:
        "requiresMirror" in parsed ? Boolean(parsed.requiresMirror) : false,
    };
  } else {
    document.texture = {
      ...document.texture,
      disableTargetRoles: [...(parsed.disableTargetRoles ?? [])],
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

/**
 * Older drafts and editor exports may carry `lifetime`; Action events own
 * timing now, so the editor drops it instead of round-tripping it.
 */
function withoutLegacyFields<T extends object>(value: T): T {
  const next = { ...value };
  delete (next as { lifetime?: unknown }).lifetime;
  return next;
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
