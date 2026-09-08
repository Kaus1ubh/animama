"use client";

import type { Object3D } from "three";

export type TransformMode = "translate" | "rotate" | "scale";
export type TransformAxis = "x" | "y" | "z";
export type TransformVector = Record<TransformAxis, number>;

export type AvatarTransform = {
  position: TransformVector;
  rotation: TransformVector;
  scale: TransformVector;
};

const POSITION_EPSILON = 1e-4;
const ROTATION_EPSILON = 1e-4;
const SCALE_EPSILON = 1e-4;

export const DEFAULT_AVATAR_TRANSFORM: AvatarTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function areVectorsEqual(
  a: TransformVector,
  b: TransformVector,
  epsilon: number,
): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

export function cloneTransformVector(vector: TransformVector): TransformVector {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function cloneAvatarTransform(
  transform: AvatarTransform,
): AvatarTransform {
  return {
    position: cloneTransformVector(transform.position),
    rotation: cloneTransformVector(transform.rotation),
    scale: cloneTransformVector(transform.scale),
  };
}

export function areAvatarTransformsEqual(
  a: AvatarTransform,
  b: AvatarTransform,
): boolean {
  return (
    areVectorsEqual(a.position, b.position, POSITION_EPSILON) &&
    areVectorsEqual(a.rotation, b.rotation, ROTATION_EPSILON) &&
    areVectorsEqual(a.scale, b.scale, SCALE_EPSILON)
  );
}

export function isUniformScale(
  scale: TransformVector,
  epsilon: number = SCALE_EPSILON,
): boolean {
  return (
    Math.abs(scale.x - scale.y) <= epsilon &&
    Math.abs(scale.y - scale.z) <= epsilon
  );
}

export function avatarTransformFromObject(object: Object3D): AvatarTransform {
  return {
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    },
    rotation: {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z,
    },
    scale: {
      x: object.scale.x,
      y: object.scale.y,
      z: object.scale.z,
    },
  };
}

export function applyAvatarTransformToObject(
  object: Object3D,
  transform: AvatarTransform,
): boolean {
  const currentTransform = avatarTransformFromObject(object);
  if (areAvatarTransformsEqual(currentTransform, transform)) {
    return false;
  }

  object.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  object.rotation.set(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
  );
  object.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  object.updateMatrixWorld();
  return true;
}
