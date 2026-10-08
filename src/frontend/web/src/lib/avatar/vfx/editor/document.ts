import type {
  AvatarEffectDefinitionV2,
  AvatarEffectFaceOptions,
  AvatarEffectMotion,
} from "@animama/runtime-contracts/api-types";

import type { PyContentDependency } from "@/lib/content/catalogTypes";
import {
  AvatarEffectDefinitionError,
  parseAvatarEffectDefinition,
  validateAvatarEffectDefinition,
} from "@/lib/avatar/vfx/definition";
import type { AvatarVFXParsedEntry } from "@/lib/avatar/vfx/types";
import {
  createDefaultAvatarEffectDocument,
  defaultAvatarEffectAttachment,
} from "./defaults";
import {
  AVATAR_EFFECT_EDITOR_SCHEMA,
  LEGACY_AVATAR_EFFECT_EDITOR_SCHEMA,
  type AvatarEffectEditorAction,
  type AvatarEffectEditorAttachment,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorExport,
  type AvatarEffectEditorImage,
  type AvatarEffectValidationIssue,
} from "./types";

type Region = AvatarEffectDefinitionV2["region"];
type FaceOptionName = keyof AvatarEffectFaceOptions;

const FACE_REGIONS: ReadonlySet<Region> = new Set([
  "eyes",
  "undereye",
  "blush",
  "mouth",
  "emote",
  "full_face",
]);

export function avatarEffectEditorReducer(
  state: AvatarEffectEditorDocument,
  action: AvatarEffectEditorAction,
): AvatarEffectEditorDocument {
  let next: AvatarEffectEditorDocument;
  switch (action.type) {
    case "replace":
      return cloneAvatarEffectDocument(action.document);
    case "set-attachment":
      if (state.attachment.kind === action.kind) return state;
      next = {
        ...state,
        attachment: defaultAvatarEffectAttachment(action.kind),
      };
      break;
    case "patch-attachment":
      next = {
        ...state,
        attachment: normalizeAvatarEffectAttachment({
          ...state.attachment,
          ...action.patch,
        } as AvatarEffectEditorAttachment),
      };
      break;
    case "patch":
      next = { ...state, ...action.patch };
      if (action.patch.region !== undefined) next.regionMode = "custom";
      break;
    case "patch-art":
      next = { ...state, art: { ...state.art, ...action.patch } };
      break;
    case "patch-appearance":
      next = {
        ...state,
        appearance: { ...state.appearance, ...action.patch },
      };
      break;
    case "set-motion":
      next = { ...state, motion: action.motion };
      break;
    case "patch-face-options":
      next = {
        ...state,
        faceOptions: { ...state.faceOptions, ...action.patch },
      };
      break;
  }
  // A custom region must still suit the attachment; otherwise follow it again.
  if (next.regionMode === "custom" && !regionSuitsAttachment(next)) {
    next.regionMode = "automatic";
  }
  if (next.regionMode === "automatic") {
    next.region = suggestedAvatarEffectRegion(next.attachment);
  }
  return next;
}

function regionSuitsAttachment(document: AvatarEffectEditorDocument): boolean {
  const kind = document.attachment.kind;
  if (kind === "body" || kind === "sticker" || kind === "silhouette")
    return document.region === kind;
  return FACE_REGIONS.has(document.region);
}

/**
 * The region an attachment replaces by default: effects on the same eyes,
 * cheeks or mouth replace each other; floating marks and whole-face art stack.
 */
export function suggestedAvatarEffectRegion(
  attachment: AvatarEffectEditorAttachment,
): Region {
  switch (attachment.kind) {
    case "face_landmark":
      return attachment.landmark === "eyes"
        ? "eyes"
        : attachment.landmark === "mouth"
          ? "mouth"
          : "emote";
    case "face_surface":
      return attachment.area === "full" ? "full_face" : attachment.area;
    default:
      return attachment.kind;
  }
}

/**
 * Repair an attachment after an edit so it obeys the `/2` cross-field rules
 * (`app/contracts/avatar_effect.py`): required fields get defaults and fields
 * that do not apply are removed.
 */
export function normalizeAvatarEffectAttachment(
  attachment: AvatarEffectEditorAttachment,
): AvatarEffectEditorAttachment {
  const next = { ...attachment } as Record<string, unknown> &
    AvatarEffectEditorAttachment;
  if (next.kind === "face_surface") {
    const paired = ["eyes", "undereye", "blush"].includes(next.area);
    const decal = ["undereye", "blush", "mouth"].includes(next.area);
    if (paired && !next.layout) {
      next.layout = "single";
      if (decal) Object.assign(next, { side: "left", mirror: true });
    }
    if (!paired) delete next.layout;
    if (next.layout !== "single") {
      delete next.side;
      delete next.mirror;
    }
    if (decal && next.layout === "single" && !next.side) next.side = "left";
    if (decal) {
      next.part = "face_skin";
      delete next.mode;
    } else {
      delete next.pivot;
    }
  } else if (next.kind === "face_landmark") {
    if (["forehead", "top", "top_edge"].includes(next.landmark)) {
      if (!next.position) next.position = "middle";
      if (next.landmark !== "top_edge" && next.position === "left_corner")
        next.position = "left";
      if (next.landmark !== "top_edge" && next.position === "right_corner")
        next.position = "right";
    } else {
      delete next.position;
    }
    if (next.landmark !== "eyes") {
      delete next.side;
      delete next.mirror;
    }
    // A mirror without a side is valid `/2` (converted and older creator
    // effects): the runtime draws it as a mirrored pair drawn for the right eye.
  }
  // `mirror: false` is the default; leave it out as stored definitions do.
  if ("mirror" in next && next.mirror === false) delete next.mirror;
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined) delete next[key];
  }
  return next;
}

/** Face options the runtime honours for an attachment; others are not saved. */
export function avatarEffectFaceOptionNames(
  attachment: AvatarEffectEditorAttachment,
): ReadonlySet<FaceOptionName> {
  if (attachment.kind === "face_landmark") {
    if (attachment.landmark === "eyes")
      return new Set([
        "forceBlink",
        "hideEyeDetails",
        "faceCleanup",
        "skinBackdrop",
        "hideParts",
      ]);
    if (attachment.landmark === "mouth")
      return new Set(["faceCleanup", "skinBackdrop"]);
  }
  if (attachment.kind === "face_surface") {
    if (attachment.area === "mouth") return new Set(["faceCleanup"]);
    if (attachment.area === "full" || attachment.area === "eyes")
      return new Set(["hideParts"]);
  }
  return new Set();
}

/** Whether `art.otherEyeImage` applies: a mirrored eye or paired face placement. */
export function avatarEffectAcceptsOtherEyeImage(
  attachment: AvatarEffectEditorAttachment,
): boolean {
  if (attachment.kind === "face_landmark")
    return attachment.landmark === "eyes" && attachment.mirror === true;
  if (attachment.kind === "face_surface")
    return (
      ["eyes", "undereye", "blush"].includes(attachment.area) &&
      attachment.mirror === true
    );
  return false;
}

export function cloneAvatarEffectDocument(
  document: AvatarEffectEditorDocument,
): AvatarEffectEditorDocument {
  const defaults = createDefaultAvatarEffectDocument();
  return structuredClone({
    ...defaults,
    ...document,
    schema: AVATAR_EFFECT_EDITOR_SCHEMA,
    art: { ...defaults.art, ...document.art },
    appearance: { ...defaults.appearance, ...document.appearance },
    motion: { ...document.motion },
    faceOptions: { ...document.faceOptions },
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

/**
 * A logical image name that differs from `taken` (the effect's other image),
 * so both images can be registered with the same effect.
 */
export function distinctAvatarEffectImageName(
  filename: string,
  taken: string | null,
  suffix: string,
): string {
  const name = canonicalAvatarEffectImageName(filename);
  if (name !== taken) return name;
  const extension = name.match(/\.[^.]+$/)?.[0] ?? "";
  const stem = name.slice(0, name.length - extension.length);
  for (let index = 1; ; index += 1) {
    const candidate = `${stem}-${suffix}${index > 1 ? `-${index}` : ""}${extension}`;
    if (candidate !== taken) return candidate;
  }
}

/** The other-eye image's logical name, distinct from the main image's. */
export function otherEyeAvatarEffectImageName(
  filename: string,
  imageName: string | null,
): string {
  return distinctAvatarEffectImageName(filename, imageName, "other");
}

const isZero = (value: number | undefined | null) => !value;
const isOne = (value: number | undefined | null) =>
  value == null || value === 1;

/**
 * The stored form of an attachment: cross-field rules applied and default
 * transforms left out, so an unedited definition saves unchanged.
 */
function storedAttachment(
  attachment: AvatarEffectEditorAttachment,
): AvatarEffectEditorAttachment {
  const next = normalizeAvatarEffectAttachment(
    structuredClone(attachment),
  ) as Record<string, unknown> & AvatarEffectEditorAttachment;
  const offset = next.offset as Record<string, number> | undefined;
  if (offset && Object.values(offset).every(isZero)) delete next.offset;
  const scale = next.scale as Record<string, number> | undefined;
  if (scale && Object.values(scale).every(isOne)) delete next.scale;
  const rotation = next.rotationDeg;
  if (
    typeof rotation === "number"
      ? rotation === 0
      : rotation && Object.values(rotation).every(isZero)
  )
    delete next.rotationDeg;
  if (next.mirror === false) delete next.mirror;
  if (next.kind === "face_surface" && next.mode === "overlay") delete next.mode;
  return next;
}

function storedMotion(motion: AvatarEffectMotion): AvatarEffectMotion | null {
  const result: AvatarEffectMotion = {};
  if (motion.pulse) result.pulse = withoutNulls(motion.pulse);
  if (motion.spin) result.spin = withoutNulls(motion.spin);
  if (motion.drift) result.drift = withoutNulls(motion.drift);
  if (motion.keyframes?.frames.length) {
    result.keyframes = {
      ...(motion.keyframes.loop ? { loop: true } : {}),
      frames: motion.keyframes.frames.map((frame) => withoutNulls(frame)),
    };
  }
  return Object.keys(result).length ? result : null;
}

function storedFaceOptions(
  document: AvatarEffectEditorDocument,
): AvatarEffectFaceOptions | null {
  const allowed = avatarEffectFaceOptionNames(document.attachment);
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(document.faceOptions)) {
    if (value == null || !allowed.has(name as FaceOptionName)) continue;
    result[name] = Array.isArray(value) ? [...value] : value;
  }
  return Object.keys(result).length
    ? (result as AvatarEffectFaceOptions)
    : null;
}

/** The `animama/avatar-effect/2` definition this document saves. */
export function avatarEffectDefinition(
  document: AvatarEffectEditorDocument,
): AvatarEffectDefinitionV2 {
  const appearance = document.appearance;
  const storedAppearance = {
    ...(appearance.opacity !== 1 ? { opacity: appearance.opacity } : {}),
    ...(appearance.tint ? { tint: appearance.tint } : {}),
    ...(appearance.blend !== "normal" ? { blend: appearance.blend } : {}),
  };
  const motion = storedMotion(document.motion);
  const faceOptions = storedFaceOptions(document);
  const otherEye =
    document.art.otherEyeImage &&
    avatarEffectAcceptsOtherEyeImage(document.attachment)
      ? document.art.otherEyeImage.logicalName
      : null;
  return {
    schema: "animama/avatar-effect/2",
    region: document.region,
    attachment: storedAttachment(document.attachment),
    art: {
      image: document.art.image?.logicalName ?? "effect.webp",
      ...(otherEye ? { otherEyeImage: otherEye } : {}),
      ...(document.art.flipbook
        ? { flipbook: structuredClone(document.art.flipbook) }
        : {}),
    },
    ...(Object.keys(storedAppearance).length
      ? { appearance: storedAppearance }
      : {}),
    ...(motion ? { motion } : {}),
    ...(faceOptions ? { faceOptions } : {}),
    ...(document.sound ? { soundAlias: document.sound.alias } : {}),
  };
}

/** Whether Save writes the other-eye image for this document. */
export function avatarEffectUsesOtherEyeImage(
  document: AvatarEffectEditorDocument,
): boolean {
  return Boolean(
    document.art.otherEyeImage &&
    avatarEffectAcceptsOtherEyeImage(document.attachment),
  );
}

/**
 * The runtime entry the preview applies. Body, sticker and silhouette effects
 * produce attachment entries; face attachments produce face entries.
 */
export function avatarEffectRuntimeEntry(
  document: AvatarEffectEditorDocument,
  urls: { image: string; otherEyeImage?: string | null },
): AvatarVFXParsedEntry {
  return parseAvatarEffectDefinition(avatarEffectDefinition(document), {
    id: "avatar-effect-editor-preview",
    label: document.name || "Avatar Effect preview",
    description:
      document.description.trim() ||
      `${document.name.trim() || "Custom Avatar Effect"} preview.`,
    assetPath: urls.image,
    ...(urls.otherEyeImage ? { otherEyeAssetPath: urls.otherEyeImage } : {}),
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

/** Plain names for definition paths, used in validation messages. */
const FIELD_LABELS: Array<[RegExp, string]> = [
  [/^attachment\.offset/, "Position"],
  [/^attachment\.scale/, "Size"],
  [/^attachment\.size/, "Size"],
  [/^attachment\.rotationDeg/, "Rotation"],
  [/^attachment\.patternScale/, "Pattern size"],
  [/^attachment\.scroll/, "Scroll speed"],
  [/^attachment/, "Placement"],
  [/^art\.flipbook/, "Flipbook"],
  [/^art\.otherEyeImage/, "Other eye image"],
  [/^art/, "Image"],
  [/^appearance\.tint/, "Tint"],
  [/^appearance/, "Look"],
  [/^motion\.keyframes/, "Keyframes"],
  [/^motion/, "Motion"],
  [/^faceOptions/, "Face options"],
  [/^region/, "Replaces"],
];

/** The plain label for a definition path below `definition`. */
export function avatarEffectFieldLabel(field: string): string {
  const path = field.replace(/^definition\.?/, "");
  return FIELD_LABELS.find(([pattern]) => pattern.test(path))?.[1] ?? "Effect";
}

export function validateAvatarEffectDocument(
  document: AvatarEffectEditorDocument,
  options: {
    imageBytesAvailable: boolean;
    otherEyeImageBytesAvailable?: boolean;
    modelCompatible?: boolean | null;
  },
): AvatarEffectValidationIssue[] {
  const issues: AvatarEffectValidationIssue[] = [];
  if (document.name.trim().length > 120) {
    issues.push({
      field: "name",
      severity: "error",
      message: "Keep the Avatar Effect name within 120 characters.",
    });
  }
  if (!document.art.image) {
    issues.push({
      field: "art.image",
      severity: "error",
      message: "Choose one PNG, JPEG, or WebP image.",
    });
  } else if (!options.imageBytesAvailable) {
    issues.push({
      field: "art.image",
      severity: "error",
      message: "Reselect the image so its bytes can be saved.",
    });
  }
  if (
    avatarEffectUsesOtherEyeImage(document) &&
    options.otherEyeImageBytesAvailable === false
  ) {
    issues.push({
      field: "art.otherEyeImage",
      severity: "error",
      message: "Reselect the other eye image so its bytes can be saved.",
    });
  }
  const flipbook = document.art.flipbook;
  if (flipbook && flipbook.frames > flipbook.columns * flipbook.rows) {
    issues.push({
      field: "art.flipbook.frames",
      severity: "error",
      message: "A flipbook cannot have more frames than columns × rows.",
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
  if (!issues.some((issue) => issue.field.startsWith("art.flipbook"))) {
    try {
      avatarEffectRuntimeEntry(document, {
        image: "blob:editor-validation",
        otherEyeImage: "blob:editor-validation-other-eye",
      });
    } catch (error) {
      const field =
        error instanceof AvatarEffectDefinitionError && error.field
          ? error.field.replace(/^definition\.?/, "") || "definition"
          : "definition";
      const detail =
        error instanceof Error
          ? error.message.replace(/^Avatar Effect definition is invalid: /, "")
          : "the settings are incompatible";
      issues.push({
        field,
        severity: "error",
        message: `${avatarEffectFieldLabel(field)}: ${detail}`,
      });
    }
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

/** Read an editor export; the pre-`/2` editor format is refused. */
export function parseAvatarEffectEditorExport(
  value: unknown,
): AvatarEffectEditorDocument {
  const record = object(value);
  const raw = object(record?.document);
  if (record?.schema === LEGACY_AVATAR_EFFECT_EDITOR_SCHEMA)
    throw new Error(
      "This document uses the earlier Avatar Effect editor format, which this creator no longer opens. Open the saved effect from the Library instead.",
    );
  if (record?.schema !== AVATAR_EFFECT_EDITOR_SCHEMA || !raw)
    throw new Error("This is not an Animama Avatar Effect editor document.");
  const document = cloneAvatarEffectDocument(
    raw as unknown as AvatarEffectEditorDocument,
  );
  document.attachment = normalizeAvatarEffectAttachment(document.attachment);
  validateAvatarEffectDefinition(avatarEffectDefinition(document));
  return document;
}

/** Open a saved `/2` definition for editing. */
export function createAvatarEffectDocumentFromDefinition(args: {
  name: string;
  description: string;
  definition: unknown;
  image: AvatarEffectEditorImage;
  otherEyeImage?: AvatarEffectEditorImage | null;
  sound: AvatarEffectEditorDocument["sound"];
}): AvatarEffectEditorDocument {
  if (!object(args.definition))
    throw new Error("The Avatar Effect definition is unavailable.");
  const definition = validateAvatarEffectDefinition(args.definition);
  if (definition.art.otherEyeImage && !args.otherEyeImage)
    throw new Error("The Avatar Effect's other eye image is unavailable.");
  const document = createDefaultAvatarEffectDocument();
  document.name = args.name;
  document.description = args.description;
  document.attachment = structuredClone(definition.attachment);
  document.region = definition.region;
  document.regionMode =
    definition.region === suggestedAvatarEffectRegion(definition.attachment)
      ? "automatic"
      : "custom";
  document.art = {
    image: args.image,
    otherEyeImage: definition.art.otherEyeImage
      ? (args.otherEyeImage ?? null)
      : null,
    flipbook: definition.art.flipbook
      ? structuredClone(definition.art.flipbook)
      : null,
  };
  document.appearance = {
    opacity: definition.appearance?.opacity ?? 1,
    tint: definition.appearance?.tint ?? null,
    blend: definition.appearance?.blend ?? "normal",
  };
  document.motion = structuredClone(definition.motion ?? {});
  document.faceOptions = structuredClone(definition.faceOptions ?? {});
  document.sound = args.sound;
  return document;
}

function withoutNulls<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child != null),
  ) as T;
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
