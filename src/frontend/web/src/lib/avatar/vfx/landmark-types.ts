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
};

export type AvatarFaceLandmarksSnapshot = {
  status: "unavailable" | "ready";
  warnings: string[];
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
