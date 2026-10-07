import type {
  AvatarEffectDefinitionV2,
  AvatarEffectFaceOptions,
  AvatarEffectFlipbook,
  AvatarEffectMotion,
} from "@animama/runtime-contracts/api-types";

import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import type { AvatarVFXBlend } from "@/lib/avatar/vfx/types";

/**
 * The Avatar Effect creator's document. It mirrors `animama/avatar-effect/2`
 * (attachment, art, appearance, motion, face options, region and sound) and
 * adds what a definition does not hold: the name, the description and the
 * metadata of the image files the definition's art names.
 */
export const AVATAR_EFFECT_EDITOR_SCHEMA =
  "animama/avatar-effect-editor/2" as const;

/** The pre-`/2` editor format. Drafts in it are dropped with a notice. */
export const LEGACY_AVATAR_EFFECT_EDITOR_SCHEMA =
  "animama/avatar-effect-editor/1" as const;

export type AvatarEffectEditorImage = {
  logicalName: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
};

export type AvatarEffectEditorSound = {
  alias: string;
  label: string;
  source: PyExactContentSource;
};

/** Where the art goes; exactly the `/2` attachment union. */
export type AvatarEffectEditorAttachment =
  AvatarEffectDefinitionV2["attachment"];

export type AvatarEffectEditorAttachmentKind =
  AvatarEffectEditorAttachment["kind"];

export type AvatarEffectEditorFaceSurface = Extract<
  AvatarEffectEditorAttachment,
  { kind: "face_surface" }
>;
export type AvatarEffectEditorFaceLandmark = Extract<
  AvatarEffectEditorAttachment,
  { kind: "face_landmark" }
>;
export type AvatarEffectEditorBody = Extract<
  AvatarEffectEditorAttachment,
  { kind: "body" }
>;
export type AvatarEffectEditorSticker = Extract<
  AvatarEffectEditorAttachment,
  { kind: "sticker" }
>;
export type AvatarEffectEditorSilhouette = Extract<
  AvatarEffectEditorAttachment,
  { kind: "silhouette" }
>;

/** The art resources: file metadata in place of the definition's file names. */
export type AvatarEffectEditorArt = {
  image: AvatarEffectEditorImage | null;
  /** Unmirrored art for the mirrored eye or side; needs a mirrored placement. */
  otherEyeImage: AvatarEffectEditorImage | null;
  flipbook: AvatarEffectFlipbook | null;
};

export type AvatarEffectEditorAppearance = {
  opacity: number;
  /** `#rrggbb` multiplied into the art, or null for none. */
  tint: string | null;
  blend: AvatarVFXBlend;
};

export type AvatarEffectEditorDocument = {
  schema: typeof AVATAR_EFFECT_EDITOR_SCHEMA;
  name: string;
  description: string;
  /** Coexistence. `automatic` follows the attachment; `custom` keeps a choice. */
  region: AvatarEffectDefinitionV2["region"];
  regionMode: "automatic" | "custom";
  attachment: AvatarEffectEditorAttachment;
  art: AvatarEffectEditorArt;
  appearance: AvatarEffectEditorAppearance;
  /** A preset is enabled when its object is present, as in `/2`. */
  motion: AvatarEffectMotion;
  /**
   * Authored face options, kept across attachment changes. Save writes only
   * the options the chosen attachment honours.
   */
  faceOptions: AvatarEffectFaceOptions;
  sound: AvatarEffectEditorSound | null;
};

/** The bytes for one of the document's images. */
export type AvatarEffectEditorImageResource = {
  file: File;
  sha256: string;
};

/** Bytes for `art.image` and `art.otherEyeImage`. */
export type AvatarEffectEditorImageResources = {
  image: AvatarEffectEditorImageResource | null;
  otherEyeImage: AvatarEffectEditorImageResource | null;
};

export type AvatarEffectEditorImageSlot =
  keyof AvatarEffectEditorImageResources;

export type AvatarEffectValidationIssue = {
  /** A definition path such as `attachment.offset.x`, or `name`, `art.image`, `sound`. */
  field: string;
  severity: "error" | "warning";
  message: string;
};

/** A partial attachment of the current kind (the reducer ignores a mismatch). */
export type AvatarEffectEditorAttachmentPatch = {
  [Kind in AvatarEffectEditorAttachmentKind]: Partial<
    Omit<Extract<AvatarEffectEditorAttachment, { kind: Kind }>, "kind">
  >;
}[AvatarEffectEditorAttachmentKind];

export type AvatarEffectEditorAction =
  | { type: "replace"; document: AvatarEffectEditorDocument }
  /** Switch attachment kind, starting from that kind's defaults. */
  | { type: "set-attachment"; kind: AvatarEffectEditorAttachmentKind }
  /** Merge into the current attachment, then repair cross-field rules. */
  | { type: "patch-attachment"; patch: AvatarEffectEditorAttachmentPatch }
  | {
      type: "patch";
      patch: Partial<
        Pick<
          AvatarEffectEditorDocument,
          "name" | "description" | "region" | "regionMode" | "sound"
        >
      >;
    }
  | { type: "patch-art"; patch: Partial<AvatarEffectEditorArt> }
  | {
      type: "patch-appearance";
      patch: Partial<AvatarEffectEditorAppearance>;
    }
  | { type: "set-motion"; motion: AvatarEffectMotion }
  | { type: "patch-face-options"; patch: Partial<AvatarEffectFaceOptions> };

export type AvatarEffectEditorExport = {
  schema: typeof AVATAR_EFFECT_EDITOR_SCHEMA;
  document: AvatarEffectEditorDocument;
};
