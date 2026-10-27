import type { AvatarIssue } from "../diagnostics/issues";

export type AvatarFaceLandmarkVector = {
  x: number;
  y: number;
  z: number;
};

export type AvatarFaceLandmarkBounds = {
  min: AvatarFaceLandmarkVector;
  max: AvatarFaceLandmarkVector;
  size: AvatarFaceLandmarkVector;
  center: AvatarFaceLandmarkVector;
};

export type AvatarFaceBoxCoordinate = {
  u: number;
  v: number;
  w: number;
};

/**
 * A rectangle in texture space: UV as glTF stores it, so `y` runs down from
 * the image's top edge, like a texture canvas.
 */
export type AvatarFaceTextureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AvatarFaceEyeLandmarkSnapshot = {
  bindingKey: string;
  materialName: string | null;
  vertexCount: number;
  boundsLocal: AvatarFaceLandmarkBounds;
  centerLocal: AvatarFaceLandmarkVector;
  centerWorld: AvatarFaceLandmarkVector | null;
  projectedFrontLocal: AvatarFaceLandmarkVector;
  projectedFrontWorld: AvatarFaceLandmarkVector | null;
  normalizedBoxCoord: AvatarFaceBoxCoordinate;
  projectedBoxCoord: AvatarFaceBoxCoordinate;
  /**
   * Where the eye's iris art lies on its texture: the island's UV bounds, or
   * those of a larger-texture layer over the whole eye. Null without UVs.
   */
  textureRect: AvatarFaceTextureRect | null;
};

export type AvatarFaceLandmarksSnapshot = {
  status: "unavailable" | "ready";
  warnings: string[];
  /** `warnings` as stable codes, for the Diagnostics view. */
  issues: AvatarIssue[];
  anchorName: string | null;
  anchorType: string | null;
  faceBindingKey: string | null;
  faceMaterialName: string | null;
  faceBoundsLocal: AvatarFaceLandmarkBounds | null;
  frontZLocal: number | null;
  boxHoverClearanceLocal: number | null;
  boxHoverFrontZLocal: number | null;
  eyes: {
    left: AvatarFaceEyeLandmarkSnapshot | null;
    right: AvatarFaceEyeLandmarkSnapshot | null;
  };
};
