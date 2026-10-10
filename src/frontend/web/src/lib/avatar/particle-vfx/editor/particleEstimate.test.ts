import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseParticleVFXRuntimeConfig } from "../runtimeConfig";
import { validateParticleVFXContentReadiness } from "./contentReadiness";
import { createParticleVFXEditorDraftFromImport } from "./draft";
import { estimateParticleVFXParticles } from "./particleEstimate";
import type { JsonObject } from "./types";
import { validateParticleVFXEditorDraft } from "./validation";

const flameLoop = (file: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../../../../../../../content/included/vfx/particle/quark/flame-loop/${file}`,
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );

/** A Quarks document with one emitter per system. */
const quarks = (
  systems: Array<{
    duration: number;
    rate: number;
    looping?: boolean;
    burst?: number;
  }>,
): JsonObject => ({
  object: {
    type: "Group",
    children: systems.map(({ duration, rate, looping = false, burst }) => ({
      type: "ParticleEmitter",
      ps: {
        duration,
        looping,
        emissionOverTime: { type: "ConstantValue", value: rate },
        emissionBursts:
          burst === undefined
            ? []
            : [
                {
                  time: 0,
                  count: { type: "ConstantValue", value: burst },
                  cycle: 1,
                },
              ],
      },
    })),
  },
});

describe("estimateParticleVFXParticles", () => {
  it("counts a looping system's emission over the longest system", () => {
    // 1 s at 10/s, then 4 s at 5/s; the looping one emits for 4 s.
    expect(
      estimateParticleVFXParticles(
        quarks([
          { duration: 1, rate: 10, looping: true, burst: 2 },
          { duration: 4, rate: 5 },
        ]),
      ),
    ).toBe(4 * 10 + 2 * 4 + 4 * 5);
  });

  it("is unbounded when an emission value is", () => {
    const document = quarks([{ duration: 1, rate: 1 }]);
    const emitter = (document.object as { children: JsonObject[] }).children[0];
    (emitter.ps as JsonObject).emissionOverTime = { type: "PiecewiseBezier" };
    expect(estimateParticleVFXParticles(document)).toBe(Infinity);
  });
});

describe("the creator and Save use the same estimate", () => {
  // The Included flame-loop loops shorter systems inside an 8 s one.
  const draft = createParticleVFXEditorDraftFromImport(
    flameLoop("particle.json"),
    parseParticleVFXRuntimeConfig(
      flameLoop("flame-loop.json").runtime_defaults.slots.particle_vfx,
    ),
  );

  it("warns in the editor with the number Save refuses", () => {
    expect(estimateParticleVFXParticles(draft.quarksJson)).toBe(79);
    expect(validateParticleVFXEditorDraft(draft)).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "particle-budget-exceeded",
        message: "Estimated 79 particles exceeds the catalog budget of 64.",
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
        message: "Estimated 79 particles exceeds the catalog budget of 64.",
      }),
    ]);
    expect(readiness.ready).toBe(false);
  });
});
