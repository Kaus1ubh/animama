import type { Object3D } from "three";

type ClonedBehavior = {
  type: string;
  axis?: { clone(): unknown };
};

type ParticleSystemLike = { behaviors: ClonedBehavior[]; prewarm?: boolean };

/**
 * Clone a loaded three.quarks prefab for one playing instance.
 *
 * three.quarks 0.17 `OrbitOverLife.clone()` rebuilds the behavior from its
 * orbit speed alone, so a cloned emitter orbits its local Y axis whatever the
 * manifest's `axis` says. `Object3D.clone` keeps the prefab's traversal order,
 * so each cloned system is paired with its source and the axis copied back.
 * `ParticleSystem.clone()` also drops `prewarm`, which is copied back too.
 */
export function cloneParticleVFXPrefab<T extends Object3D>(prefab: T): T {
  const clone = prefab.clone(true) as T;
  const sources = particleSystems(prefab);
  const copies = particleSystems(clone);
  sources.forEach((source, systemIndex) => {
    const copy = copies[systemIndex];
    if (copy && source.prewarm !== undefined) copy.prewarm = source.prewarm;
    source.behaviors.forEach((behavior, behaviorIndex) => {
      const copied = copy?.behaviors[behaviorIndex];
      if (
        behavior.type === "OrbitOverLife" &&
        copied?.type === "OrbitOverLife" &&
        behavior.axis
      ) {
        copied.axis = behavior.axis.clone() as ClonedBehavior["axis"];
      }
    });
  });
  return clone;
}

function particleSystems(object: Object3D): ParticleSystemLike[] {
  const systems: ParticleSystemLike[] = [];
  object.traverse((child) => {
    const system = (child as { system?: Partial<ParticleSystemLike> }).system;
    if (child.type === "ParticleEmitter" && Array.isArray(system?.behaviors))
      systems.push(system as ParticleSystemLike);
  });
  return systems;
}
