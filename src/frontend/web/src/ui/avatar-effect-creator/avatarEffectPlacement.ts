import type {
  AvatarEffectEditorAttachment,
  AvatarEffectEditorAttachmentKind,
  AvatarEffectEditorAttachmentPatch,
} from "@/lib/avatar/vfx/editor";

/*
 * Plain-language placement for the Avatar Effect creator: the attachment
 * choices, the units each attachment's numbers use, and how a drag, a handle
 * or an arrow key changes the authored `/2` values.
 */

export const ATTACHMENT_OPTIONS: ReadonlyArray<{
  value: AvatarEffectEditorAttachmentKind;
  label: string;
  description: string;
}> = [
  {
    value: "face_landmark",
    label: "Floating on the face",
    description: "A flat image in front of the eyes, mouth or forehead.",
  },
  {
    value: "face_surface",
    label: "Painted on the face",
    description: "Drawn onto the skin or eyes, so it follows the face.",
  },
  {
    value: "body",
    label: "On the body",
    description: "Follows a body point such as the chest or a hand.",
  },
  {
    value: "sticker",
    label: "Sticker beside the avatar",
    description: "Comic lettering or a sticker that stays readable.",
  },
  {
    value: "silhouette",
    label: "Fill the silhouette",
    description: "A pattern or tint drawn only over the avatar.",
  },
];

/** How one attachment's position numbers are shown: stored value × factor. */
export type PlacementUnit = {
  label: string;
  /** Multiply a stored value by this to show it. */
  factor: number;
  step: number;
  decimals: number;
  /** Stored bounds, from the `/2` contract. */
  min: number;
  max: number;
};

const CENTIMETRES: Omit<PlacementUnit, "min" | "max"> = {
  label: "cm",
  factor: 100,
  step: 0.1,
  decimals: 1,
};
const PERCENT: Omit<PlacementUnit, "min" | "max"> = {
  label: "%",
  factor: 100,
  step: 0.5,
  decimals: 1,
};

/** Units for the position (offset) of each attachment. */
export function positionUnit(
  kind: AvatarEffectEditorAttachmentKind,
): PlacementUnit {
  if (kind === "face_surface") return { ...PERCENT, min: -2, max: 2 };
  if (kind === "sticker") return { ...PERCENT, min: -10, max: 10 };
  if (kind === "silhouette") return { ...PERCENT, min: -10, max: 10 };
  return { ...CENTIMETRES, min: -5, max: 5 };
}

/** Units for a body or sticker size (plane height). */
export function sizeUnit(kind: "body" | "sticker"): PlacementUnit {
  return kind === "body"
    ? { ...CENTIMETRES, step: 0.5, min: 0.001, max: 5 }
    : { ...PERCENT, step: 1, decimals: 0, min: 0.001, max: 2 };
}

/** What a position's numbers mean, for field hints. */
export function positionHint(kind: AvatarEffectEditorAttachmentKind): string {
  switch (kind) {
    case "face_surface":
      return "Percent of the painted texture.";
    case "face_landmark":
      return "Centimetres from the face point.";
    case "body":
      return "Centimetres from the body point.";
    case "sticker":
      return "Percent of the avatar's height.";
    case "silhouette":
      return "Percent of a pattern tile.";
  }
}

export const MAX_SCALE = 20;
export const MIN_SCALE = 0.01;
export const MAX_ROTATION_DEGREES = 3600;

/** The values the placement fields and handles edit, with defaults filled in. */
export type ResolvedPlacement = {
  offset: { x: number; y: number; z: number };
  /** Face art: per-axis scale. Body and sticker: `size` instead. */
  scale: { x: number; y: number } | null;
  size: number | null;
  /** In-plane rotation in degrees. */
  rotationDeg: number;
  /** Face landmarks only: tilt around x and y, in degrees. */
  tilt: { x: number; y: number } | null;
};

export function resolvedPlacement(
  attachment: AvatarEffectEditorAttachment,
): ResolvedPlacement | null {
  switch (attachment.kind) {
    case "face_surface":
      return {
        offset: {
          x: attachment.offset?.x ?? 0,
          y: attachment.offset?.y ?? 0,
          z: 0,
        },
        scale: { x: attachment.scale?.x ?? 1, y: attachment.scale?.y ?? 1 },
        size: null,
        rotationDeg: attachment.rotationDeg ?? 0,
        tilt: null,
      };
    case "face_landmark":
      return {
        offset: {
          x: attachment.offset?.x ?? 0,
          y: attachment.offset?.y ?? 0,
          z: attachment.offset?.z ?? 0,
        },
        scale: { x: attachment.scale?.x ?? 1, y: attachment.scale?.y ?? 1 },
        size: null,
        rotationDeg: attachment.rotationDeg?.z ?? 0,
        tilt: {
          x: attachment.rotationDeg?.x ?? 0,
          y: attachment.rotationDeg?.y ?? 0,
        },
      };
    case "body":
      return {
        offset: {
          x: attachment.offset?.x ?? 0,
          y: attachment.offset?.y ?? 0,
          z: attachment.offset?.z ?? 0,
        },
        scale: null,
        size: attachment.size ?? 0.2,
        rotationDeg: attachment.rotationDeg ?? 0,
        tilt: null,
      };
    case "sticker":
      return {
        offset: {
          x: attachment.offset?.x ?? 0,
          y: attachment.offset?.y ?? 0,
          z: 0,
        },
        scale: null,
        size: attachment.size ?? 0.25,
        rotationDeg: attachment.rotationDeg ?? 0,
        tilt: null,
      };
    case "silhouette":
      return null;
  }
}

const round = (value: number, decimals: number) =>
  Number(value.toFixed(decimals));
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Store an offset within the attachment's contract bounds, rounded for display. */
export function placementOffsetPatch(
  attachment: AvatarEffectEditorAttachment,
  offset: { x: number; y: number; z?: number },
): AvatarEffectEditorAttachmentPatch {
  const unit = positionUnit(attachment.kind);
  const value = (axis: number) => round(clamp(axis, unit.min, unit.max), 5);
  if (attachment.kind === "face_landmark" || attachment.kind === "body") {
    return {
      offset: {
        x: value(offset.x),
        y: value(offset.y),
        z: value(offset.z ?? attachment.offset?.z ?? 0),
      },
    };
  }
  return { offset: { x: value(offset.x), y: value(offset.y) } };
}

/** Multiply the art's size by `factor` (a scale handle or a size field). */
export function placementScalePatch(
  attachment: AvatarEffectEditorAttachment,
  start: ResolvedPlacement,
  factor: number,
): AvatarEffectEditorAttachmentPatch | null {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  if (attachment.kind === "body" || attachment.kind === "sticker") {
    const unit = sizeUnit(attachment.kind);
    return {
      size: round(clamp((start.size ?? 0.2) * factor, unit.min, unit.max), 4),
    };
  }
  if (!start.scale) return null;
  const scale = (value: number) =>
    round(clamp(value * factor, MIN_SCALE, MAX_SCALE), 3);
  return { scale: { x: scale(start.scale.x), y: scale(start.scale.y) } };
}

/** Set the in-plane rotation, in degrees. */
export function placementRotationPatch(
  attachment: AvatarEffectEditorAttachment,
  degrees: number,
): AvatarEffectEditorAttachmentPatch | null {
  const value = round(
    clamp(degrees, -MAX_ROTATION_DEGREES, MAX_ROTATION_DEGREES),
    1,
  );
  if (attachment.kind === "face_landmark") {
    return {
      rotationDeg: {
        x: attachment.rotationDeg?.x ?? 0,
        y: attachment.rotationDeg?.y ?? 0,
        z: value,
      },
    };
  }
  if (attachment.kind === "silhouette") return null;
  return { rotationDeg: value };
}

/**
 * Which copies a paired placement draws, in plain terms. `mirrored` draws the
 * art on its side and a mirrored copy on the other; `between` is one image
 * centred between the eyes; `across` is one image across both sides.
 */
export type SidesChoice =
  | "both"
  | "mirrored"
  | "left"
  | "right"
  | "between"
  | "across";

export const SIDES_LABELS: Record<SidesChoice, string> = {
  both: "Both eyes",
  mirrored: "Both sides, mirrored",
  left: "Left only",
  right: "Right only",
  between: "One image between the eyes",
  across: "One image across both sides",
};

/** The side choices an attachment offers, or none when it has no sides. */
export function sidesChoices(
  attachment: AvatarEffectEditorAttachment,
): SidesChoice[] {
  if (attachment.kind === "face_landmark")
    return attachment.landmark === "eyes"
      ? ["mirrored", "left", "right", "between"]
      : [];
  if (attachment.kind !== "face_surface") return [];
  if (attachment.area === "eyes")
    return ["both", "mirrored", "left", "right", "across"];
  if (attachment.area === "undereye" || attachment.area === "blush")
    return ["mirrored", "left", "right", "across"];
  return [];
}

export function sidesChoice(
  attachment: AvatarEffectEditorAttachment,
): SidesChoice | null {
  if (attachment.kind === "face_landmark") {
    if (attachment.landmark !== "eyes") return null;
    // A mirror without a side draws a pair, drawn for the right eye.
    if (attachment.mirror) return "mirrored";
    return attachment.side ?? "between";
  }
  if (attachment.kind !== "face_surface") return null;
  if (!["eyes", "undereye", "blush"].includes(attachment.area)) return null;
  if (attachment.layout === "span") return "across";
  if (!attachment.side) return "both";
  return attachment.mirror ? "mirrored" : attachment.side;
}

/**
 * The attachment fields for a side choice. A mirrored choice keeps the side
 * the art is drawn for; the other side gets the mirrored copy.
 */
export function sidesChoicePatch(
  attachment: AvatarEffectEditorAttachment,
  choice: SidesChoice,
): AvatarEffectEditorAttachmentPatch {
  const drawnFor =
    "side" in attachment && attachment.side ? attachment.side : "right";
  const surface = attachment.kind === "face_surface";
  switch (choice) {
    case "mirrored":
      return {
        ...(surface ? { layout: "single" as const } : {}),
        side: drawnFor,
        mirror: true,
      };
    case "left":
    case "right":
      return {
        ...(surface ? { layout: "single" as const } : {}),
        side: choice,
        mirror: false,
      };
    case "both":
      return { layout: "single", side: null, mirror: false };
    case "between":
      return { side: null, mirror: false };
    case "across":
      return { layout: "span", side: null, mirror: false };
  }
}
