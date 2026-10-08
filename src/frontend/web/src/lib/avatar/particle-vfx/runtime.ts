import * as THREE from "three";

import type { Avatar } from "../Avatar";
import { resolveHumanoidAnchorObject } from "../humanoidAnchors";
import { AVATAR_PARTICLE_VFX_CATALOG } from "./catalog";
import {
  PARTICLE_VFX_ANCHORS,
  type ParticleVFXAnchor,
  type ParticleVFXCatalogEntry,
  type ParticleVFXResolvedAnchor,
  type ParticleVFXTransform,
  type ParticleVFXTransformAxisTriple,
  type ParticleVFXTransformInput,
} from "./types";

const PARTICLE_VFX_CATALOG_BY_ID = new Map<string, ParticleVFXCatalogEntry>(
  AVATAR_PARTICLE_VFX_CATALOG.map((entry) => [entry.id, entry]),
);

export function getParticleVFXCatalogEntryById(
  effectId: string,
): ParticleVFXCatalogEntry | null {
  return PARTICLE_VFX_CATALOG_BY_ID.get(effectId) ?? null;
}

export function getParticleVFXCatalogIds(): string[] {
  return AVATAR_PARTICLE_VFX_CATALOG.map((entry) => entry.id);
}

export function isParticleVFXAnchor(
  value: unknown,
): value is ParticleVFXAnchor {
  return (
    typeof value === "string" &&
    (PARTICLE_VFX_ANCHORS as readonly string[]).includes(value)
  );
}

export function cloneParticleVFXTransform(
  transform: ParticleVFXTransform,
): ParticleVFXTransform {
  return {
    offset: { ...transform.offset },
    depthOffset: transform.depthOffset,
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}

export function normalizeParticleVFXTransform(
  value: ParticleVFXTransformInput | null | undefined,
): ParticleVFXTransform {
  return mergeParticleVFXTransform(
    {
      offset: { x: 0, y: 0, z: 0 },
      depthOffset: 0,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    value,
  );
}

export function mergeParticleVFXTransform(
  base: ParticleVFXTransform,
  override: ParticleVFXTransformInput | null | undefined,
): ParticleVFXTransform {
  const next = cloneParticleVFXTransform(base);
  if (!override) return next;

  next.offset = mergeAxisTriple(next.offset, override.offset);
  next.rotation = mergeAxisTriple(next.rotation, override.rotation);
  next.scale = mergeAxisTriple(next.scale, override.scale);
  if (
    typeof override.depthOffset === "number" &&
    Number.isFinite(override.depthOffset)
  ) {
    next.depthOffset = override.depthOffset;
  }
  return next;
}

export function getParticleVFXCombinedOffset(
  transform: ParticleVFXTransform,
): ParticleVFXTransformAxisTriple {
  return {
    x: transform.offset.x,
    y: transform.offset.y,
    z: transform.offset.z + transform.depthOffset,
  };
}

export function resolveParticleVFXAnchorLocalPosition(args: {
  avatar: Avatar;
  anchor: ParticleVFXAnchor;
  transform?: ParticleVFXTransform;
}): ParticleVFXResolvedAnchor | null {
  const scene = args.avatar.scene;
  if (!scene) return null;

  scene.updateMatrixWorld(true);
  const combinedOffset = getParticleVFXCombinedOffset(
    args.transform ?? normalizeParticleVFXTransform(null),
  );

  if (args.anchor === "root") {
    return {
      requestedAnchor: args.anchor,
      resolvedAnchor: "root",
      boneName: null,
      position: combinedOffset,
      warning: null,
    };
  }

  const resolved = resolveHumanoidAnchorObject(args.avatar, args.anchor);
  if (resolved?.boneName) {
    const boneNode = resolved.object;
    boneNode.updateMatrixWorld(true);
    const localPosition = scene.worldToLocal(
      boneNode.getWorldPosition(new THREE.Vector3()),
    );
    localPosition.add(
      new THREE.Vector3(combinedOffset.x, combinedOffset.y, combinedOffset.z),
    );

    return {
      requestedAnchor: args.anchor,
      resolvedAnchor: args.anchor,
      boneName: resolved.boneName,
      position: vectorToAxisTriple(localPosition),
      warning: resolved.fellBack
        ? `Particle VFX anchor "${args.anchor}" fell back to VRM bone "${resolved.boneName}".`
        : null,
    };
  }

  return {
    requestedAnchor: args.anchor,
    resolvedAnchor: "root",
    boneName: null,
    position: combinedOffset,
    warning: `Particle VFX anchor "${args.anchor}" could not resolve a VRM bone and fell back to root.`,
  };
}

function mergeAxisTriple(
  base: ParticleVFXTransformAxisTriple,
  override: Partial<ParticleVFXTransformAxisTriple> | null | undefined,
): ParticleVFXTransformAxisTriple {
  return {
    x: readFiniteNumber(override?.x, base.x),
    y: readFiniteNumber(override?.y, base.y),
    z: readFiniteNumber(override?.z, base.z),
  };
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function vectorToAxisTriple(
  vector: THREE.Vector3,
): ParticleVFXTransformAxisTriple {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}
