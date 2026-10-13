import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseParticleVFXRuntimeConfig } from "../runtimeConfig";
import { validateParticleVFXContentReadiness } from "./contentReadiness";
import { createParticleVFXEditorDraftFromImport } from "./draft";
import { estimateParticleVFXParticles } from "./particleEstimate";
import type { JsonObject } from "./types";
import { validateParticleVFXEditorDraft } from "./validation";

const rageAura = (file: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../../../../../../content/included/vfx/particle/quark/rage-aura/${file}`,
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );

interface TestBurst {
  count: number;
  time?: number;
  cycle?: number;
  interval?: number;
}

/** A Quarks document with one emitter per system. */
const quarks = (
  systems: Array<{
    duration: number;
    rate: number;
    life: number | [number, number];
    looping?: boolean;
    bursts?: TestBurst[];
    trailLength?: number;
  }>,
): JsonObject => ({
  object: {
    type: "Group",
    children: systems.map(
      ({
        duration,
        rate,
        life,
        looping = false,
        bursts = [],
        trailLength,
      }) => ({
        type: "ParticleEmitter",
        ps: {
          duration,
          looping,
          ...(trailLength === undefined
            ? {}
            : {
                renderMode: 3,
                rendererEmitterSettings: {
                  startLength: { type: "ConstantValue", value: trailLength },
                },
              }),
          startLife: Array.isArray(life)
            ? { type: "IntervalValue", a: life[0], b: life[1] }
            : { type: "ConstantValue", value: life },
          emissionOverTime: { type: "ConstantValue", value: rate },
          emissionBursts: bursts.map(({ count, time = 0, ...rest }) => ({
            time,
            count: { type: "ConstantValue", value: count },
            probability: 1,
            ...rest,
          })),
        },
      }),
    ),
  },
});

describe("estimateParticleVFXParticles", () => {
  it("counts a loop's particles alive at once, not every particle it emits", () => {
    // A 30 s loop at 20/s whose particles live up to 2 s: 600 emitted, 40
    // alive, plus the one the runtime may spawn ahead by rounding up.
    expect(
      estimateParticleVFXParticles(
        quarks([{ duration: 30, rate: 20, life: [1, 2], looping: true }]),
      ),
    ).toBe(41);
    // Simulated in three.quarks 0.17.1: 3/s with 1 s lives peaks at 4.
    expect(
      estimateParticleVFXParticles(
        quarks([{ duration: 5, rate: 3, life: 1, looping: true }]),
      ),
    ).toBe(4);
  });

  it("limits a one-shot stream by its emission window or its lifetimes", () => {
    // 0.5 s at 10/s with 3 s lives: the runtime keeps emitting for up to one
    // clamped 0.1 s frame past the window and spawns 6 (7 bounds it).
    expect(
      estimateParticleVFXParticles(
        quarks([{ duration: 0.5, rate: 10, life: 3 }]),
      ),
    ).toBe(7);
    // 2 s at 10/s with 0.5 s lives: 20 emitted, 5 alive, plus one ahead.
    expect(
      estimateParticleVFXParticles(
        quarks([{ duration: 2, rate: 10, life: 0.5 }]),
      ),
    ).toBe(6);
  });

  it("keeps a trail counted while its trail drains after its life", () => {
    // 2 s at 20/s, 0.5 s lives, 30-point trails: simulated peak 20. A trail
    // loses one point per frame, so it can outlive its life by 30 × 0.1 s.
    expect(
      estimateParticleVFXParticles(
        quarks([{ duration: 2, rate: 20, life: 0.5, trailLength: 30 }]),
      ),
    ).toBe(43);
  });

  it("adds a looping burst once for each repeat still alive", () => {
    // A 10-particle burst every 1 s whose particles live 2.5 s: three waves.
    expect(
      estimateParticleVFXParticles(
        quarks([
          {
            duration: 1,
            rate: 0,
            life: 2.5,
            looping: true,
            bursts: [{ count: 10 }],
          },
        ]),
      ),
    ).toBe(30);
    // Played once, only the one wave exists.
    expect(
      estimateParticleVFXParticles(
        quarks([{ duration: 1, rate: 0, life: 2.5, bursts: [{ count: 10 }] }]),
      ),
    ).toBe(10);
  });

  it("counts burst cycles alive together and overlapping bursts", () => {
    // Four 5-particle waves 0.5 s apart living 1.2 s: at most three overlap.
    // A second 2-particle burst may overlap them too.
    expect(
      estimateParticleVFXParticles(
        quarks([
          {
            duration: 3,
            rate: 0,
            life: 1.2,
            bursts: [
              { count: 5, cycle: 4, interval: 0.5 },
              { count: 2, time: 1 },
            ],
          },
        ]),
      ),
    ).toBe(3 * 5 + 2);
  });

  it("rounds each burst's count up, as the runtime spawns it", () => {
    // Two bursts of up to 2.5 particles each spawn 3 apiece.
    const document = quarks([
      { duration: 1, rate: 0, life: 2, bursts: [{ count: 2 }, { count: 2 }] },
    ]);
    for (const burst of (
      (document.object as { children: JsonObject[] }).children[0]
        .ps as JsonObject
    ).emissionBursts as JsonObject[])
      burst.count = { type: "IntervalValue", a: 1, b: 2.5 };
    expect(estimateParticleVFXParticles(document)).toBe(6);
  });

  it("assumes the creator's 30-point trail when a trail names no length", () => {
    const document = quarks([{ duration: 2, rate: 20, life: 0.5 }]);
    Object.assign(
      (document.object as { children: JsonObject[] }).children[0]
        .ps as JsonObject,
      { renderMode: 3 },
    );
    expect(estimateParticleVFXParticles(document)).toBe(43);
  });

  it("sums each emitter's peak, rounding each up", () => {
    // 6/s for 1 s lives (6 + 1) plus 2.2/s for 1.8 s lives (3.96 + 1) and a
    // 3-particle burst.
    expect(
      estimateParticleVFXParticles(
        quarks([
          { duration: 5, rate: 6, life: [0.7, 1], looping: true },
          { duration: 2, rate: 2.2, life: 1.8, bursts: [{ count: 3 }] },
        ]),
      ),
    ).toBe(7 + Math.ceil(2.2 * 1.8 + 1 + 3));
  });

  it("is unbounded when an emission or lifetime value is", () => {
    const document = quarks([{ duration: 1, rate: 1, life: 1 }]);
    const emitter = (document.object as { children: JsonObject[] }).children[0];
    (emitter.ps as JsonObject).emissionOverTime = { type: "PiecewiseBezier" };
    expect(estimateParticleVFXParticles(document)).toBe(Infinity);

    const lifeless = quarks([{ duration: 1, rate: 1, life: 1 }]);
    (
      (lifeless.object as { children: JsonObject[] }).children[0]
        .ps as JsonObject
    ).startLife = { type: "PiecewiseBezier" };
    expect(estimateParticleVFXParticles(lifeless)).toBe(Infinity);
  });
});

describe("the creator and Save use the same estimate", () => {
  // The Included Rage Aura's five layers peak at 50 particles
  // (1 + 1 + 1 + 35 + 12); a 32-particle budget is too small for them.
  const draft = createParticleVFXEditorDraftFromImport(
    rageAura("particle.json"),
    parseParticleVFXRuntimeConfig(
      rageAura("rage-aura.json").runtime_defaults.slots.particle_vfx,
    ),
  );
  draft.catalog.performanceBudget.maxParticles = 32;

  it("warns in the editor with the number Save refuses", () => {
    expect(estimateParticleVFXParticles(draft.quarksJson)).toBe(50);
    expect(validateParticleVFXEditorDraft(draft)).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "particle-budget-exceeded",
        message: "Estimated 50 particles exceeds the catalog budget of 32.",
      }),
    );
    const readiness = validateParticleVFXContentReadiness(draft, {
      resolvableTextureReferences: new Set(
        (draft.quarksJson.images as Array<{ url: string }>).map(
          ({ url }) => url,
        ),
      ),
    });
    // Save refuses it with the same numbers, once.
    expect(
      readiness.issues.filter(
        ({ code }) => code === "particle-budget-exceeded",
      ),
    ).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Estimated 50 particles exceeds the catalog budget of 32.",
      }),
    ]);
    expect(readiness.ready).toBe(false);
  });
});
