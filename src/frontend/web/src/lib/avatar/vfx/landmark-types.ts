import type { AvatarIssue } from "../diagnostics/issues";
import type { AvatarEyeEstimate } from "./faceParts";

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
   * Where the eye's iris art lies on its texture's image: the island's UV
   * bounds through the iris texture's transform, or those of a
   * larger-texture layer over the whole eye. Null without UVs.
   */
  textureRect: AvatarFaceTextureRect | null;
  /**
   * Present (true) when that art runs mirrored against VRoid's: its image x
   * grows toward the Avatar's right instead of its left, as on a model whose
   * eyes share mirrored UVs. Iris art is then mirrored for this eye.
   */
  textureMirrored?: boolean;
  /**
   * Present for an eye without geometry of its own (painted on the face, or
   * modelled inside the face primitive): what its position is estimated
   * from. A `blink` eye's `textureRect` bounds the face texture where blink
   * moves; an eye placed from its bone has none.
   */
  estimate?: AvatarEyeEstimate;
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
