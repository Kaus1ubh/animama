import type * as THREE from "three";

import type {
  AvatarFaceLandmarkBounds,
  AvatarFaceLandmarkVector,
} from "./landmark-types";
import type { AvatarFaceTextureAnchorSource } from "./texture-anchor-types";
import type { AvatarVFXTextureSlot } from "./types";

export type AvatarVFXGuidePoint2 = { x: number; y: number };

/** All 3D coordinates are local to the borrowed face anchor, never cached world positions. */
export type AvatarVFXSpatialGuide = {
  label: string;
  reference: AvatarFaceLandmarkVector;
  source: AvatarFaceTextureAnchorSource;
  /** Current rendered rectangle, including transparent image padding; empty while inactive. */
  artwork: AvatarFaceLandmarkVector[];
};

/** Normalized source-image coordinates: (0,0) is the top-left of the displayed canvas. */
export type AvatarVFXUvGuide = {
  label: string;
  kind: "reference" | "artwork" | "flatten" | "sample";
  shape: "polygon" | "ellipse";
  points: AvatarVFXGuidePoint2[];
  pivot?: AvatarVFXGuidePoint2;
  source?: AvatarFaceTextureAnchorSource;
};

/** Surfaces and their images are borrowed. A guide consumer must never dispose or alter them. */
export type AvatarVFXGuideSurface = {
  key: string;
  materialName: string;
  slot: AvatarVFXTextureSlot;
  image: CanvasImageSource;
  width: number;
  height: number;
  guides: AvatarVFXUvGuide[];
};

export type AvatarVFXPlacementGuides = {
  anchor: THREE.Object3D | null;
  faceBounds: AvatarFaceLandmarkBounds | null;
  spatial: AvatarVFXSpatialGuide[];
  surfaces: AvatarVFXGuideSurface[];
  /** Concise missing-data or fallback explanations; no internal binding IDs. */
  messages: string[];
  active: boolean;
};
