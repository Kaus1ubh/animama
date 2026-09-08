import type { Object3D } from "three";

export const PARTICLE_VFX_ANCHORS = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
] as const;

export type ParticleVFXAnchor = (typeof PARTICLE_VFX_ANCHORS)[number];

export type ParticleVFXTransformAxisTriple = {
  x: number;
  y: number;
  z: number;
};

export type ParticleVFXTransform = {
  offset: ParticleVFXTransformAxisTriple;
  depthOffset: number;
  rotation: ParticleVFXTransformAxisTriple;
  scale: ParticleVFXTransformAxisTriple;
};

export type ParticleVFXTransformInput = {
  offset?: Partial<ParticleVFXTransformAxisTriple>;
  depthOffset?: number;
  rotation?: Partial<ParticleVFXTransformAxisTriple>;
  scale?: Partial<ParticleVFXTransformAxisTriple>;
};

export const PARTICLE_VFX_PRELOAD_TIERS = ["tierA", "tierB", "none"] as const;

export type ParticleVFXPreloadTier =
  (typeof PARTICLE_VFX_PRELOAD_TIERS)[number];

export type ParticleVFXPerformanceBudget = {
  maxDurationSec: number;
  maxParticles: number;
  loopingAllowed: boolean;
  canCoexist: boolean;
};

export type ParticleVFXShapeAutoFit = {
  kind: "avatarBoundsRectangle";
  padding?: {
    width?: number;
    height?: number;
  };
  minSize?: {
    width?: number;
    height?: number;
  };
  maxSize?: {
    width?: number;
    height?: number;
  };
  emitterNames?: string[];
};

export type ParticleVFXCatalogEntry = {
  id: string;
  label: string;
  description: string;
  assetPath: string;
  defaultAnchor: ParticleVFXAnchor;
  defaultDurationSec: number;
  defaultFollowAnchor: boolean;
  defaultTransform: ParticleVFXTransform;
  preloadTier: ParticleVFXPreloadTier;
  performanceBudget: ParticleVFXPerformanceBudget;
  shapeAutoFit?: ParticleVFXShapeAutoFit;
};

export type ParticleVFXPreloadResult = {
  requestedCount: number;
  loadedCount: number;
  failedCount: number;
};

export type ParticleVFXRuntimeLifetime =
  | {
      kind: "duration";
      durationSec: number;
    }
  | {
      kind: "manual";
    };

export type ParticleVFXPlayRequest = {
  effectId: string;
  appliedId?: string;
  ownerId?: string;
  anchor?: ParticleVFXAnchor;
  durationSec?: number;
  lifetime?: ParticleVFXRuntimeLifetime;
  transform?: ParticleVFXTransformInput;
  followAnchor?: boolean;
};

export type ParticleVFXResolvedAnchor = {
  requestedAnchor: ParticleVFXAnchor;
  resolvedAnchor: ParticleVFXAnchor;
  boneName: string | null;
  position: ParticleVFXTransformAxisTriple;
  warning: string | null;
};

export type ParticleVFXRuntimeInstanceSnapshot = {
  appliedId: string;
  ownerId: string | null;
  effectId: string;
  effectLabel: string;
  assetPath: string;
  anchor: ParticleVFXAnchor;
  resolvedAnchor: ParticleVFXAnchor;
  boneName: string | null;
  lifetime: ParticleVFXRuntimeLifetime;
  durationSec: number | null;
  elapsedSec: number;
  followAnchor: boolean;
  usesWorldSpace: boolean;
  transform: ParticleVFXTransform;
};

export type ParticleVFXControllerSnapshot = {
  catalog: readonly ParticleVFXCatalogEntry[];
  activeInstances: ParticleVFXRuntimeInstanceSnapshot[];
  activeCount: number;
  loadedEffectIds: string[];
  loadedCount: number;
  warnings: string[];
  lastError: string | null;
};

export type ParticleVFXRuntimeInstance = {
  appliedId: string;
  ownerId: string | null;
  effect: ParticleVFXCatalogEntry;
  anchor: ParticleVFXAnchor;
  lifetime: ParticleVFXRuntimeLifetime;
  durationSec: number | null;
  elapsedSec: number;
  transform: ParticleVFXTransform;
  followAnchor: boolean;
  usesWorldSpace: boolean;
  object: Object3D;
  resolvedAnchor: ParticleVFXResolvedAnchor;
};
