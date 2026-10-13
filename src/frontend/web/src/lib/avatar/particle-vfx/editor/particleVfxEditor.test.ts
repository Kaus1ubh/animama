import { describe, expect, it } from "vitest";
import {
  applyParticleVFXEmitterPatch,
  addParticleVFXEditorEmitter,
  createParticleVFXEditorDraftFromImport,
  createParticleVFXEditorDraftFromBlank,
  updateParticleVFXEditorCatalogDraft,
} from "./draft";
import { readJsonObject } from "./json";
import { resolveParticleVFXEditorPreviewJson } from "./preview";
import { validateParticleVFXContentReadiness } from "./contentReadiness";

describe("Particle VFX Asset readiness", () => {
  it("accepts representative helper output and deduplicates a shared texture", () => {
    let draft = createParticleVFXEditorDraftFromBlank();
    const emitterPath = draft.emitters[0]!.path;
    draft = applyParticleVFXEmitterPatch(draft, emitterPath, {
      emitterTemplateId: "aura",
      shape: {
        type: "rectangle",
        width: 1.2,
        height: 0.8,
        thickness: 0.5,
      },
      renderer: { renderMode: 5 },
    });
    const images = draft.quarksJson.images as unknown[];
    const firstImage = readJsonObject(images[0]);
    images.push({
      uuid: "shared-texture-image",
      url: firstImage?.url,
    });

    const result = validateParticleVFXContentReadiness(draft);

    expect(result.issues).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.uniqueTextureReferences).toEqual(["textures/glow-soft.png"]);
    expect(result.estimatedManifestBytes).toBeGreaterThan(0);
  });

  it("blocks unresolved resources and runtime budgets below authored content", () => {
    const initial = createParticleVFXEditorDraftFromBlank();
    const draft = updateParticleVFXEditorCatalogDraft(initial, {
      performanceBudget: {
        ...initial.catalog.performanceBudget,
        maxParticles: 1,
      },
    });

    const result = validateParticleVFXContentReadiness(draft, {
      resolvableTextureReferences: new Set(),
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unresolved-texture" }),
        expect.objectContaining({ code: "particle-budget-exceeded" }),
      ]),
    );
  });

  it("accepts up to sixteen emitters and blocks a seventeenth", () => {
    let draft = createParticleVFXEditorDraftFromBlank();
    while (draft.emitters.length < 16) {
      draft = addParticleVFXEditorEmitter(draft);
    }
    const systemLimit = (value: typeof draft) =>
      validateParticleVFXContentReadiness(value).issues.filter(
        (issue) => issue.code === "asset-system-limit",
      );

    expect(systemLimit(draft)).toEqual([]);
    expect(systemLimit(addParticleVFXEditorEmitter(draft))).toEqual([
      expect.objectContaining({
        message: "Particle VFX must contain between 1 and 16 emitters.",
      }),
    ]);
  });

  it("allows only an exact trusted legacy App texture reference", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const rawImage = readJsonObject((draft.quarksJson.images as unknown[])[0]);
    rawImage!.url = "../particle-vfx/textures/soft-dot.png";
    const resolvableTextureReferences = new Set([
      "../particle-vfx/textures/soft-dot.png",
    ]);

    expect(
      validateParticleVFXContentReadiness(draft, {
        resolvableTextureReferences,
        trustedLegacyTextureReferences: resolvableTextureReferences,
      }).ready,
    ).toBe(true);
    expect(
      validateParticleVFXContentReadiness(draft, {
        resolvableTextureReferences,
        trustedLegacyTextureReferences: new Set(),
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsafe-texture-reference" }),
      ]),
    );
  });

  it("keeps package-local manifest references separate from preview URLs", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const rawImage = readJsonObject((draft.quarksJson.images as unknown[])[0]);
    const preview = resolveParticleVFXEditorPreviewJson(draft);
    const previewImage = readJsonObject((preview.images as unknown[])[0]);

    expect(rawImage?.url).toBe("textures/soft-dot.png");
    expect(previewImage?.url).toBe(
      "/effects/vfx/particle-vfx/textures/soft-dot.png",
    );
  });

  it("rewrites only a preview clone and fails closed for missing private resources", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const rawImage = readJsonObject((draft.quarksJson.images as unknown[])[0]);
    const preview = resolveParticleVFXEditorPreviewJson(
      draft,
      new Map([["textures/soft-dot.png", "blob:owned-texture"]]),
    );
    const previewImage = readJsonObject((preview.images as unknown[])[0]);

    expect(previewImage?.url).toBe("blob:owned-texture");
    expect(rawImage?.url).toBe("textures/soft-dot.png");

    rawImage!.url = "textures/private-only.png";
    expect(() => resolveParticleVFXEditorPreviewJson(draft, new Map())).toThrow(
      "textures/private-only.png is unavailable",
    );
  });
});

describe("Per-emitter anchor authoring", () => {
  it("round-trips independent overrides and returns to inheritance without losing metadata", () => {
    let draft = addParticleVFXEditorEmitter(
      createParticleVFXEditorDraftFromBlank(),
    );
    expect(draft.emitters.map((emitter) => emitter.anchor)).toEqual([
      null,
      null,
    ]);
    const root = draft.quarksJson.object as {
      children: Record<string, unknown>[];
    };
    root.children[0]!.userData = { authorNote: "preserved" };
    draft = applyParticleVFXEmitterPatch(draft, draft.emitters[0]!.path, {
      anchor: "head",
      localPosition: { x: 0.2, y: 0.1 },
    });
    draft = applyParticleVFXEmitterPatch(draft, draft.emitters[1]!.path, {
      anchor: "leftHand",
    });
    const reopened = createParticleVFXEditorDraftFromImport(
      JSON.parse(JSON.stringify(draft.quarksJson)),
      draft.catalog,
    );
    expect(reopened.emitters.map((emitter) => emitter.anchor)).toEqual([
      "head",
      "leftHand",
    ]);
    expect(reopened.emitters[0]!.localPosition).toEqual({
      x: 0.2,
      y: 0.1,
      z: 0,
    });
    const inherited = applyParticleVFXEmitterPatch(
      reopened,
      reopened.emitters[0]!.path,
      { anchor: null },
    );
    expect(inherited.emitters[0]!.anchor).toBeNull();
    expect(
      (inherited.quarksJson.object as typeof root).children[0]!.userData,
    ).toEqual({ authorNote: "preserved" });
  });

  it("blocks an unsupported serialized anchor rather than silently changing its meaning", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    (
      draft.quarksJson.object as { children: Record<string, unknown>[] }
    ).children[0]!.userData = { animamaParticleAnchor: "tail" };
    const imported = createParticleVFXEditorDraftFromImport(draft.quarksJson);
    expect(validateParticleVFXContentReadiness(imported).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-emitter-anchor",
          severity: "error",
        }),
      ]),
    );
  });
});
