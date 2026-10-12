import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  parseParticleVFXRuntimeConfig,
  particleVFXRuntimeSlotConfig,
} from "../runtimeConfig";
import {
  PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA,
  buildParticleVFXCreatorDocument,
  readParticleVFXCreatorDocument,
} from "./creatorDocument";
import { createParticleVFXEditorDraftFromImport } from "./draft";

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

const slot = rageAura("rage-aura.json").runtime_defaults.slots.particle_vfx;
const draft = createParticleVFXEditorDraftFromImport(
  rageAura("particle.json"),
  {
    ...parseParticleVFXRuntimeConfig(slot),
    label: "Rage aura",
    description: "A layered flame aura",
  },
);

describe("Particle creator documents", () => {
  it("carry the Quarks effect with its settings through Import", () => {
    const document = JSON.parse(
      JSON.stringify(buildParticleVFXCreatorDocument(draft)),
    );
    expect(document.schema).toBe(PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA);
    expect(document.name).toBe("Rage aura");
    const read = readParticleVFXCreatorDocument(document);
    if (!read || "severity" in read) throw new Error("not read");
    expect(read.quarksJson).toEqual(draft.quarksJson);
    // Everything but the creator-local id and asset path travels.
    const catalog: Record<string, unknown> = { ...draft.catalog };
    delete catalog.id;
    delete catalog.assetPath;
    expect(read.catalog).toEqual(catalog);
  });

  it("store settings in the form Save writes and playback reads", () => {
    const stored = particleVFXRuntimeSlotConfig(draft.catalog);
    expect(stored).toMatchObject({
      label: "Rage aura",
      description: "A layered flame aura",
      anchor: slot.anchor,
      max_particles: slot.max_particles,
    });
    const defaults = draft.catalog;
    expect(parseParticleVFXRuntimeConfig(stored)).toEqual(
      expect.objectContaining({
        defaultAnchor: defaults.defaultAnchor,
        defaultTransform: defaults.defaultTransform,
        performanceBudget: defaults.performanceBudget,
        preloadTier: defaults.preloadTier,
      }),
    );
  });

  it("leave plain Quarks JSON to the Quarks import", () => {
    expect(readParticleVFXCreatorDocument(rageAura("particle.json"))).toBe(
      null,
    );
  });

  it("refuse an incomplete document", () => {
    for (const document of [
      { schema: PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA, name: "x", settings: {} },
      {
        schema: PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA,
        name: "x",
        quarks: {},
      },
      {
        schema: PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA,
        name: 3,
        quarks: {},
        settings: {},
      },
    ])
      expect(readParticleVFXCreatorDocument(document)).toMatchObject({
        severity: "error",
        code: "invalid-json",
      });
  });
});
