import type { AvatarIssue } from "../diagnostics/issues";
import type { AvatarVFXSide, AvatarVFXTextureAnchor } from "./types";
import type { AvatarFaceLandmarkVector } from "./landmark-types";

/**
 * A position on the face texture's image, 0–1 with `v` down from its top
 * edge: the mesh UV through the texture's transform and wrapping
 * (`TextureUvMapping`), so art drawn there lands on the projected point.
 */
export type AvatarFaceTextureUvCoordinate = {
  u: number;
  v: number;
};

/** A size on the face texture's image (`Uv` sizes) or in anchor space. */
export type AvatarFaceTextureReferenceSize = {
  width: number;
  height: number;
};

export type AvatarFaceTextureAnchorSource =
  | "expression"
  | "fallback"
  | "geometric";

export type AvatarFaceTextureFlattenRegion = "sample" | "eye" | "mouth";

export type AvatarFaceTextureAnchorSnapshot = {
  anchor: AvatarVFXTextureAnchor;
  side: AvatarVFXSide | null;
  source: AvatarFaceTextureAnchorSource;
  localPoint: AvatarFaceLandmarkVector;
  worldPoint: AvatarFaceLandmarkVector | null;
  uv: AvatarFaceTextureUvCoordinate;
  referenceSizeLocal: AvatarFaceTextureReferenceSize;
  referenceSizeUv: AvatarFaceTextureReferenceSize;
  /**
   * Set when a surface lies over the anchor (eyes or a mouth modelled over
   * the skin, `FaceCover`), so art painted there would not show and is
   * skipped. Absent on an anchor that shows.
   */
  covered?: true;
};

export type AvatarFaceTextureFlattenRegionSnapshot = {
  region: AvatarFaceTextureFlattenRegion;
  side: AvatarVFXSide | null;
  source: AvatarFaceTextureAnchorSource;
  localPoint: AvatarFaceLandmarkVector;
  worldPoint: AvatarFaceLandmarkVector | null;
  uv: AvatarFaceTextureUvCoordinate;
  referenceSizeLocal: AvatarFaceTextureReferenceSize;
  referenceSizeUv: AvatarFaceTextureReferenceSize;
};

export type AvatarFaceTextureAnchorsSnapshot = {
  status: "unavailable" | "ready";
  warnings: string[];
  /** `warnings` as stable codes, for the Diagnostics view. */
  issues: AvatarIssue[];
  faceBindingKey: string | null;
  faceMaterialName: string | null;
  anchors: {
    undereye: {
      left: AvatarFaceTextureAnchorSnapshot | null;
      right: AvatarFaceTextureAnchorSnapshot | null;
    };
    blush: {
      left: AvatarFaceTextureAnchorSnapshot | null;
      right: AvatarFaceTextureAnchorSnapshot | null;
    };
    mouth: {
      center: AvatarFaceTextureAnchorSnapshot | null;
    };
  };
  flatten: {
    sample: {
      center: AvatarFaceTextureFlattenRegionSnapshot | null;
    };
    eyes: {
      left: AvatarFaceTextureFlattenRegionSnapshot | null;
      right: AvatarFaceTextureFlattenRegionSnapshot | null;
    };
    mouth: {
      center: AvatarFaceTextureFlattenRegionSnapshot | null;
    };
  };
};
