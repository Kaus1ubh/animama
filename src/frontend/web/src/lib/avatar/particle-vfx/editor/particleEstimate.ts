import { readJsonObject } from "./json";
import type { JsonObject } from "./types";

/**
 * three.quarks 0.17.1 clamps a frame's step to 0.1 s; a one-shot system keeps
 * emitting until a frame starts past its `duration`, and a trail particle
 * loses one trail point per frame after its life ends.
 */
const QUARKS_MAX_FRAME_SECONDS = 0.1;
/** three.quarks' trail render mode (`RenderMode.Trail`). */
const TRAIL_RENDER_MODE = 3;
/** The trail length the creator gives a trail that names none. */
const DEFAULT_TRAIL_LENGTH = 30;

/**
 * The conservative estimate of particles alive at once that the creator
 * shows, warns with and enforces on Save (and `effects check` reports). Each
 * system's peak is computed from its emission timing and the upper bound of
 * its `startLife`, and the peaks are summed as if they coincided:
 *
 *   peak = ceil(stream + Σ bursts count × waves × repeats)
 *   stream = rate × min(life, window) + 1   (0 without a rate)
 *
 * - `rate` is the maximum `emissionOverTime`; `window` is the system's
 *   `duration` plus one clamped frame, or unlimited for a looping system (it
 *   emits for the whole playback, so its stream settles at rate × life). The
 *   `+ 1` covers the runtime spawning `ceil` of the particles owed.
 * - `life` is the upper bound of `startLife`; a trail also counts while its
 *   trail drains, `startLength` frames of at most 0.1 s.
 * - `waves` assumes a burst fires `cycle` waves `interval` seconds apart
 *   (0.17.1 fires each burst once per loop, so this only over-counts):
 *   `cycle`, or min(cycle, ceil(life / interval)) for a positive interval.
 * - `repeats` is 1 for a one-shot system; a looping system re-fires its bursts
 *   every `duration`, so ceil((life + (cycle - 1) × interval) / duration)
 *   loops' waves can overlap.
 *
 * Burst `probability` is treated as 1 and every burst is assumed to overlap.
 * Emission over distance is not counted. Infinite when a rate, lifetime,
 * burst or duration value is unbounded or unsupported. The backend checks a
 * manifest's structure, not its particle count, so this is the only estimate.
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

  let total = 0;
  for (const system of systems) {
    const peak = estimateSystemPeak(system);
    if (!Number.isFinite(peak)) return Infinity;
    total += peak;
  }
  return total;
}

/** One system's peak live particles (see `estimateParticleVFXParticles`). */
function estimateSystemPeak(system: JsonObject): number {
  const duration = finiteNumber(system.duration);
  const rate = nonnegativeGeneratorMaximum(system.emissionOverTime);
  const startLife = nonnegativeGeneratorMaximum(system.startLife);
  const trailDrain =
    system.renderMode === TRAIL_RENDER_MODE
      ? trailLength(system) * QUARKS_MAX_FRAME_SECONDS
      : 0;
  const life = startLife + trailDrain;
  if (!duration || !Number.isFinite(rate) || !Number.isFinite(life)) {
    return Infinity;
  }
  const looping = system.looping === true;
  const window = duration + QUARKS_MAX_FRAME_SECONDS;
  let peak =
    rate > 0 ? rate * (looping ? life : Math.min(life, window)) + 1 : 0;
  const bursts = Array.isArray(system.emissionBursts)
    ? system.emissionBursts
    : [];
  for (const rawBurst of bursts) {
    const burst = readJsonObject(rawBurst);
    const count = nonnegativeGeneratorMaximum(burst?.count);
    const cycles = finiteNumber(burst?.cycle ?? 1);
    // A missing interval fires every wave at once, the most crowded case.
    const interval = finiteNumber(burst?.interval ?? 0, true);
    if (!burst || !Number.isFinite(count) || !cycles || interval === null) {
      return Infinity;
    }
    const waveCount = Math.ceil(cycles);
    const waves =
      interval > 0
        ? Math.min(waveCount, Math.ceil(life / interval))
        : waveCount;
    const repeats = looping
      ? Math.max(1, Math.ceil((life + (waveCount - 1) * interval) / duration))
      : 1;
    // The runtime spawns a fractional count's ceiling.
    peak += Math.ceil(count) * waves * repeats;
  }
  return Math.ceil(peak);
}

function trailLength(system: JsonObject): number {
  const startLength = readJsonObject(
    system.rendererEmitterSettings,
  )?.startLength;
  return startLength === undefined
    ? DEFAULT_TRAIL_LENGTH
    : nonnegativeGeneratorMaximum(startLength);
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
