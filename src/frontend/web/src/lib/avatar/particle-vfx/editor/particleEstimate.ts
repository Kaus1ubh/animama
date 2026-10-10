import { readJsonObject } from "./json";
import type { JsonObject } from "./types";

/**
 * The conservative live-particle estimate the creator shows, warns with and
 * enforces on Save (and `effects check` reports): each system emits for its
 * duration at its maximum rate plus its bursts, and a looping system for the
 * longest system's duration. Infinite when an emission value is unbounded.
 * The backend checks a manifest's structure, not its particle count, so this
 * is the only estimate.
 */
export function estimateParticleVFXParticles(quarksJson: JsonObject): number {
  const systems: JsonObject[] = [];
  const visit = (rawNode: unknown) => {
    const node = readJsonObject(rawNode);
    if (!node) return;
    if (node.type === "ParticleEmitter") {
      const system = readJsonObject(node.ps);
      if (system) systems.push(system);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(quarksJson.object);

  const maximumDuration = Math.max(
    0,
    ...systems.map((system) => finiteNumber(system.duration) ?? Infinity),
  );
  let total = 0;
  for (const system of systems) {
    const duration = finiteNumber(system.duration);
    const emissionRate = nonnegativeGeneratorMaximum(system.emissionOverTime);
    if (!duration || !Number.isFinite(emissionRate)) return Infinity;
    const bursts = Array.isArray(system.emissionBursts)
      ? system.emissionBursts
      : [];
    let burstParticles = 0;
    for (const rawBurst of bursts) {
      const burst = readJsonObject(rawBurst);
      const count = nonnegativeGeneratorMaximum(burst?.count);
      const cycle = finiteNumber(burst?.cycle ?? 1);
      if (!burst || !Number.isFinite(count) || !cycle) return Infinity;
      burstParticles += count * Math.ceil(cycle);
    }
    const looping = system.looping === true;
    const activeDuration = looping ? maximumDuration : duration;
    const burstRepetitions = looping
      ? Math.ceil(maximumDuration / duration)
      : 1;
    total += Math.ceil(
      activeDuration * emissionRate + burstParticles * burstRepetitions,
    );
  }
  return total;
}

function nonnegativeGeneratorMaximum(value: unknown): number {
  const generator = readJsonObject(value);
  if (generator?.type === "ConstantValue") {
    const number = finiteNumber(generator.value, true);
    return number ?? Infinity;
  }
  if (generator?.type === "IntervalValue") {
    const a = finiteNumber(generator.a, true);
    const b = finiteNumber(generator.b, true);
    return a === null || b === null ? Infinity : Math.max(a, b);
  }
  return Infinity;
}

function finiteNumber(value: unknown, allowZero = false): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0)
    ? value
    : null;
}
