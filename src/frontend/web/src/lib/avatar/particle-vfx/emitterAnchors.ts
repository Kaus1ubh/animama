import { Group, Object3D, Vector3 } from "three";

import type { Avatar } from "../Avatar";
import {
  isParticleVFXAnchor,
  resolveParticleVFXAnchorLocalPosition,
} from "./runtime";
import type { ParticleVFXAnchor } from "./types";

export type ParticleVFXEmitterAnchorBindings = {
  object: Object3D;
  emitters: Array<{
    object: Object3D;
    anchor: ParticleVFXAnchor | null;
    authoredPosition: Vector3;
    targetWorldPosition: Vector3;
  }>;
};

/** Keep an emitter-root resource's authored offset separate from effect placement. */
export function createParticleVFXEffectContainer(object: Object3D): Object3D {
  if (object.type !== "ParticleEmitter") return object;
  const container = new Group();
  container.add(object);
  return container;
}

/** Capture authored offsets before any runtime anchor adjustment is applied. */
export function createParticleVFXEmitterAnchorBindings(
  object: Object3D,
): ParticleVFXEmitterAnchorBindings {
  const emitters: ParticleVFXEmitterAnchorBindings["emitters"] = [];
  object.traverse((child) => {
    if (child.type !== "ParticleEmitter") return;
    const anchor = child.userData.animamaParticleAnchor;
    if (anchor !== undefined && !isParticleVFXAnchor(anchor)) {
      throw new Error(
        `Particle emitter "${child.name || child.uuid}" has unsupported anchor "${String(anchor)}".`,
      );
    }
    emitters.push({
      object: child,
      anchor: isParticleVFXAnchor(anchor) ? anchor : null,
      authoredPosition: child.position.clone(),
      targetWorldPosition: new Vector3(),
    });
  });
  return { object, emitters };
}

/**
 * Replace only each emitter's anchor contribution, retaining authored parent
 * transforms and offsets. Two passes prevent nested emitters from inheriting an
 * ancestor emitter's override, and resetting offsets prevents frame-to-frame drift.
 * The effect container uses avatar-local coordinates in both preview and playback.
 */
export function updateParticleVFXEmitterAnchors(args: {
  bindings: ParticleVFXEmitterAnchorBindings;
  avatar: Avatar | null | undefined;
  defaultAnchor: ParticleVFXAnchor;
}): string[] {
  const { bindings, avatar, defaultAnchor } = args;
  if (!avatar || !bindings.emitters.some((emitter) => emitter.anchor))
    return [];
  const base = resolveParticleVFXAnchorLocalPosition({
    avatar,
    anchor: defaultAnchor,
  });
  if (!base) return [];
  const warnings: string[] = [];
  const anchors = new Map<ParticleVFXAnchor, Vector3>();
  const container = bindings.object.parent;
  container?.updateWorldMatrix(true, false);
  const containerOrigin =
    container?.getWorldPosition(new Vector3()) ?? new Vector3();
  for (const emitter of bindings.emitters) {
    emitter.object.position.copy(emitter.authoredPosition);
  }
  bindings.object.updateWorldMatrix(true, true);
  for (const emitter of bindings.emitters) {
    emitter.object.getWorldPosition(emitter.targetWorldPosition);
    if (!emitter.anchor || emitter.anchor === defaultAnchor) continue;
    let delta = anchors.get(emitter.anchor);
    if (!delta) {
      const resolved = resolveParticleVFXAnchorLocalPosition({
        avatar,
        anchor: emitter.anchor,
      });
      if (!resolved) continue;
      if (resolved.warning) warnings.push(resolved.warning);
      delta = new Vector3(
        resolved.position.x - base.position.x,
        resolved.position.y - base.position.y,
        resolved.position.z - base.position.z,
      );
      // Anchor deltas are avatar-local distances; parent scale/rotation must be
      // applied once, while the effect's own transform applies to offsets only.
      if (container) delta = container.localToWorld(delta).sub(containerOrigin);
      anchors.set(emitter.anchor, delta);
    }
    emitter.targetWorldPosition.add(delta);
  }
  // Object3D traversal is parent-first, so each parent's final matrix is ready.
  for (const emitter of bindings.emitters) {
    const parent = emitter.object.parent;
    emitter.object.position.copy(
      parent
        ? parent.worldToLocal(emitter.targetWorldPosition.clone())
        : emitter.targetWorldPosition,
    );
    emitter.object.updateWorldMatrix(false, true);
  }
  return warnings;
}
