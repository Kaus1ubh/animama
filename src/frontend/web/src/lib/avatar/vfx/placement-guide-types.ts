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

/**
 * One rendered copy of an applied effect's art, for direct manipulation.
 * Corners are world positions of the image's top-left, top-right,
 * bottom-right and bottom-left, as drawn this frame.
 */
export type AvatarVFXManipulationPlacement = {
  label: string;
  /**
   * The effect's own mirrored copy (`effectMirror`): its lateral offset is
   * mirrored, so dragging it moves the offset the other way.
   */
  mirrored: boolean;
  corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  center: THREE.Vector3;
  /**
   * +1 when a larger authored rotation turns the image's x axis toward its
   * (downward) y axis, −1 when it turns away; screen handedness is separate.
   */
  rotationSense: 1 | -1;
};

/** What a creator needs to drag, scale and rotate one applied effect. */
export type AvatarVFXManipulationFrame = {
  attachment: "face_surface" | "face_landmark" | "body" | "sticker";
  placements: AvatarVFXManipulationPlacement[];
  /**
   * World matrix of the frame offsets are measured in: the head anchor for
   * face landmarks, the bone frame for body effects; null otherwise.
   */
  offsetSpace: THREE.Matrix4 | null;
  /** Face-surface art: the mesh whose UVs the offset moves across. */
  surface: THREE.Mesh | null;
  /** Stickers: world length of one avatar height (their offset unit). */
  unitLength: number | null;
};
