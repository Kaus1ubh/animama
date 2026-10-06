import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import type {
  AvatarVFXAnimationConfig,
  AvatarVFXApplyMode,
  AvatarVFXAssetShape,
  AvatarVFXHoverKind,
  AvatarVFXHoverPlacement,
  AvatarVFXKind,
  AvatarVFXRegion,
  AvatarVFXSide,
  AvatarVFXTargetRole,
  AvatarVFXTextureAnchor,
  AvatarVFXTextureLayout,
  AvatarVFXTexturePivot,
  AvatarVFXTransform,
} from "@/lib/avatar/vfx/types";

export const AVATAR_EFFECT_EDITOR_SCHEMA =
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

export type AvatarEffectHoverSettings = {
  hoverKind: AvatarVFXHoverKind;
  placement: AvatarVFXHoverPlacement;
  side: AvatarVFXSide | null;
  requiresMirror: boolean;
  skinBackdrop: boolean;
  forceBlink: boolean;
  autoDisableEyeMaterials: boolean;
  faceCleanup: boolean;
  disableTargetRoles: AvatarVFXTargetRole[];
};

export type AvatarEffectFaceSettings = {
  anchor: AvatarVFXTextureAnchor;
  faceCleanup: boolean;
  layout: AvatarVFXTextureLayout;
  pivot: AvatarVFXTexturePivot;
  side: AvatarVFXSide;
  requiresMirror: boolean;
};

export type AvatarEffectTextureSettings = {
  targetRole: AvatarVFXTargetRole;
  disableTargetRoles: AvatarVFXTargetRole[];
  assetShape: AvatarVFXAssetShape;
  applyMode: AvatarVFXApplyMode;
  side: AvatarVFXSide | null;
  requiresMirror: boolean;
};

export type AvatarEffectEditorDocument = {
  schema: typeof AVATAR_EFFECT_EDITOR_SCHEMA;
  name: string;
  description: string;
  kind: AvatarVFXKind;
  region: AvatarVFXRegion;
  regionMode: "automatic" | "custom";
  transform: AvatarVFXTransform;
  animationConfig: AvatarVFXAnimationConfig | null;
  image: AvatarEffectEditorImage | null;
  sound: AvatarEffectEditorSound | null;
  hover: AvatarEffectHoverSettings;
  face: AvatarEffectFaceSettings;
  texture: AvatarEffectTextureSettings;
};

export type AvatarEffectEditorImageResource = {
  file: File;
  sha256: string;
};

export type AvatarEffectValidationIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
};

export type AvatarEffectEditorAction =
  | { type: "replace"; document: AvatarEffectEditorDocument }
  | { type: "set-kind"; kind: AvatarVFXKind }
  | {
      type: "patch";
      patch: Partial<
        Omit<
          AvatarEffectEditorDocument,
          "schema" | "hover" | "face" | "texture"
        >
      >;
    }
  | { type: "patch-hover"; patch: Partial<AvatarEffectHoverSettings> }
  | { type: "patch-face"; patch: Partial<AvatarEffectFaceSettings> }
  | { type: "patch-texture"; patch: Partial<AvatarEffectTextureSettings> };

export type AvatarEffectEditorExport = {
  schema: typeof AVATAR_EFFECT_EDITOR_SCHEMA;
  document: AvatarEffectEditorDocument;
};
