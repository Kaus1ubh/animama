import type { AvatarVFXSide, AvatarVFXTextureAnchor } from "./types";
import type { AvatarFaceLandmarkVector } from "./landmark-types";

export type AvatarFaceTextureUvCoordinate = {
  u: number;
  v: number;
};

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
