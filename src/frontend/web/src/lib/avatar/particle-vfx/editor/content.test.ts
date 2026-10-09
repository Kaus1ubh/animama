import { describe, expect, it } from "vitest";

import { buildParticleVFXContentPackage } from "@/lib/content/particleVFXContentPackage";
import { createParticleVFXEditorDraftFromContent } from "./content";
import {
  applyParticleVFXEmitterPatch,
  createParticleVFXEditorDraftFromBlank,
  updateParticleVFXEditorCatalogDraft,
} from "./draft";
import { parseParticleVFXRuntimeConfig } from "../runtimeConfig";

const fetcher = async () =>
  new Response(
    new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ]),
    { headers: { "content-type": "image/png" } },
  );

describe("particle catalog content hydration", () => {
  it("round trips whole-effect defaults and independent anchors through the saved package", async () => {
    let draft = createParticleVFXEditorDraftFromBlank();
    draft = applyParticleVFXEmitterPatch(draft, draft.emitters[0]!.path, {
      anchor: "rightHand",
      shape: { type: "rectangle", width: 0.6, height: 0.8 },
    });
    draft = updateParticleVFXEditorCatalogDraft(draft, {
      id: "anchored-sparkles",
      label: "Anchored sparkles",
      description: "Preserved description",
      defaultAnchor: "chest",
      defaultDurationSec: 1.5,
      defaultFollowAnchor: false,
      defaultTransform: {
        offset: { x: 0.1, y: 0.2, z: 0.3 },
        depthOffset: 0.4,
        rotation: { x: 0.5, y: 0.6, z: 0.7 },
        scale: { x: 0.8, y: 0.9, z: 1.1 },
      },
      preloadTier: "tierB",
      performanceBudget: {
        maxDurationSec: 2,
        maxParticles: 48,
        loopingAllowed: true,
        canCoexist: false,
      },
      shapeAutoFit: {
        kind: "avatarBoundsRectangle",
        padding: { width: 0.2, height: 0.3 },
        minSize: { width: 0.4, height: 0.5 },
        maxSize: { width: 0.8, height: 1.2 },
        emitterNames: [draft.emitters[0]!.name],
      },
    });
    const built = await buildParticleVFXContentPackage({
      draft,
      resources: [],
      fetcher,
    });
    const reopened = createParticleVFXEditorDraftFromContent(
      JSON.parse(await built.manifestFile.text()),
      {
        item_id: "different-catalog-id",
        name: draft.catalog.label,
        description: draft.catalog.description,
        metadata: built.authoringManifest,
      },
    );
    expect(reopened.catalog).toEqual({
      ...built.normalizedDraft.catalog,
      assetPath: "/effects/vfx/quark/anchored-sparkles.json",
    });
    expect(reopened.emitters[0]?.anchor).toBe("rightHand");
    const savedAgain = await buildParticleVFXContentPackage({
      draft: reopened,
      resources: [],
      fetcher,
    });
    expect(savedAgain.authoringManifest).toEqual(built.authoringManifest);
  });

  it("uses legacy editor defaults without metadata and retains an omitted description", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const reopened = createParticleVFXEditorDraftFromContent(draft.quarksJson, {
      item_id: "legacy-id",
      name: "Legacy",
    });
    expect(reopened.catalog).toMatchObject({
      id: "legacy-id",
      label: "Legacy",
      description: "",
      defaultAnchor: "head",
      defaultDurationSec: 2,
    });
  });

  it("preserves explicit disabled preload and lower authored duration budget", () => {
    const fallback = createParticleVFXEditorDraftFromBlank().catalog;
    fallback.preloadTier = "tierA";
    const parsed = parseParticleVFXRuntimeConfig(
      { preload_tier: "none", max_duration_seconds: 1 },
      fallback,
    );
    expect(parsed.preloadTier).toBe("none");
    expect(parsed.performanceBudget.maxDurationSec).toBe(1);
  });
});
