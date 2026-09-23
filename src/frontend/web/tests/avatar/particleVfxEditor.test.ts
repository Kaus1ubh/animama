import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

import type { Avatar } from "@/lib/avatar";
import {
  PARTICLE_VFX_EDITOR_COLOR_THEME_PRESETS,
  PARTICLE_VFX_EDITOR_TEXTURE_MANIFEST,
  PARTICLE_VFX_EDITOR_TEXTURES,
  addParticleVFXEditorEmitter,
  applyParticleVFXEmitterPatch,
  buildParticleVFXEditorExport,
  createParticleVFXEditorDraftFromBlank,
  createParticleVFXEditorDraftFromCatalog,
  createParticleVFXEditorDraftFromImport,
  duplicateParticleVFXEditorEmitter,
  parseParticleVFXEditorExportJsonForViewer,
  removeParticleVFXEditorEmitter,
  resolveParticleVFXCreatorPreviewPlacement,
  resolveParticleVFXEditorPreviewJson,
  resolveParticleVFXPublicAssetPath,
  updateParticleVFXEditorCatalogDraft,
  validateParticleVFXEditorDraft,
} from "@/lib/avatar/particle-vfx";

const INCLUDED_PARTICLE_VFX_ROOT = new URL(
  "../../../../../content/included/vfx/particle/",
  import.meta.url,
);

function readQuarksJson(effectId = "hearts"): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(`quark/${effectId}/particle.json`, INCLUDED_PARTICLE_VFX_ROOT),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function createMockAvatar(bones: Record<string, Vector3>): Avatar {
  const scene = new Group();
  const boneNodes = new Map<string, Object3D>();

  for (const [boneName, position] of Object.entries(bones)) {
    const node = new Object3D();
    node.position.copy(position);
    scene.add(node);
    boneNodes.set(boneName, node);
  }
  scene.updateMatrixWorld(true);

  return {
    scene,
    vrm: {
      humanoid: {
        getNormalizedBoneNode: (boneName: string) =>
          boneNodes.get(boneName) ?? null,
      },
    } as never,
  } as Avatar;
}

function getFirstEmitterPs(draft: {
  quarksJson: Record<string, unknown>;
}): Record<string, unknown> {
  const object = draft.quarksJson.object as Record<string, unknown>;
  const children = object.children as Array<Record<string, unknown>>;
  const emitter = children.find((child) => child.type === "ParticleEmitter");
  expect(emitter).toBeTruthy();
  return emitter!.ps as Record<string, unknown>;
}

function getColorOverLifeBehavior(
  ps: Record<string, unknown>,
): Record<string, unknown> {
  const behaviors = ps.behaviors as Array<Record<string, unknown>>;
  const behavior = behaviors.find((item) => item.type === "ColorOverLife");
  expect(behavior).toBeTruthy();
  return behavior!;
}

describe("particle VFX editor helpers", () => {
  it("creates a repo-ready blank draft with one editable emitter", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const exported = buildParticleVFXEditorExport(draft);

    expect(draft.source).toBe("new");
    expect(draft.catalog.id).toBe("custom-particle-vfx");
    expect(draft.emitters).toHaveLength(1);
    expect(draft.emitters[0]).toMatchObject({
      name: "emitter-1",
      textureId: "soft-dot",
      textureUrl: "textures/soft-dot.png",
      durationSec: 1.2,
      looping: false,
      worldSpace: false,
      burst: expect.objectContaining({
        time: 0,
        count: { min: 12, max: 12 },
      }),
      shape: expect.objectContaining({ type: "sphere" }),
      renderer: expect.objectContaining({
        renderMode: 0,
        blending: "additive",
        uTileCount: 1,
        vTileCount: 1,
      }),
      hasSizeOverLife: true,
      hasColorOverLife: true,
    });
    expect(validateParticleVFXEditorDraft(draft)).toEqual([]);
    expect(exported.quarksJson).toContain('"url": "textures/soft-dot.png"');
    expect(exported.quarksJson).not.toContain("blob:");
  });

  it("uses the curated texture catalog for new drafts and preview resolution", () => {
    const draft = createParticleVFXEditorDraftFromBlank("heart");
    const textureIds = PARTICLE_VFX_EDITOR_TEXTURES.map(
      (texture) => texture.id,
    );

    expect(textureIds).toContain("heart");
    expect(draft.emitters[0]?.textureId).toBe("heart");
    expect(
      (
        resolveParticleVFXEditorPreviewJson(draft).images as Array<{
          url: string;
        }>
      )[0].url,
    ).toBe("/effects/vfx/particle-vfx/textures/heart.png");
  });

  it("exposes every manifest texture in the editor texture catalog", () => {
    expect(PARTICLE_VFX_EDITOR_TEXTURES).toHaveLength(
      PARTICLE_VFX_EDITOR_TEXTURE_MANIFEST.length,
    );

    for (const manifestEntry of PARTICLE_VFX_EDITOR_TEXTURE_MANIFEST) {
      const texture = PARTICLE_VFX_EDITOR_TEXTURES.find(
        (entry) => entry.id === manifestEntry.id,
      );
      expect(texture).toMatchObject({
        ...manifestEntry,
        relativeUrl: `textures/${manifestEntry.fileName}`,
        publicUrl: `/effects/vfx/particle-vfx/textures/${manifestEntry.fileName}`,
      });
      const texturePath = new URL(
        `particle-vfx/textures/${manifestEntry.fileName}`,
        INCLUDED_PARTICLE_VFX_ROOT,
      );
      expect(existsSync(texturePath)).toBe(true);
    }
  });

  it("creates blank drafts from representative texture roles", () => {
    const representativeTextureIds = [
      "glow-soft",
      "spark-cross",
      "smoke-puff",
      "speed-line",
      "magic-ring",
    ];

    for (const textureId of representativeTextureIds) {
      const texture = PARTICLE_VFX_EDITOR_TEXTURES.find(
        (entry) => entry.id === textureId,
      )!;
      const draft = createParticleVFXEditorDraftFromBlank(texture.id);

      expect(draft.emitters[0]).toMatchObject({
        textureId: texture.id,
        textureUrl: texture.relativeUrl,
        renderer: expect.objectContaining({
          blending: texture.recommendedBlending,
          renderMode: texture.recommendedRenderMode,
          uTileCount: texture.atlas?.uTileCount ?? 1,
          vTileCount: texture.atlas?.vTileCount ?? 1,
        }),
      });
      expect(validateParticleVFXEditorDraft(draft)).toEqual([]);
    }
  });

  it("creates blank drafts with atlas metadata and frame animation defaults", () => {
    const draft = createParticleVFXEditorDraftFromBlank("fire-8x8");
    const emitter = draft.emitters[0];
    const ps = getFirstEmitterPs(draft);
    const frameOverLife = (ps.behaviors as Array<Record<string, unknown>>).find(
      (behavior) => behavior.type === "FrameOverLife",
    );

    expect(emitter).toMatchObject({
      textureId: "fire-8x8",
      textureUrl: "textures/fire-8x8.png",
      renderer: expect.objectContaining({
        uTileCount: 8,
        vTileCount: 8,
        blendTiles: false,
      }),
      frameOverLife: {
        mode: "linear",
        startFrame: 0,
        endFrame: 63,
      },
    });
    expect(ps).toMatchObject({
      uTileCount: 8,
      vTileCount: 8,
      blendTiles: false,
    });
    expect(frameOverLife).toMatchObject({
      type: "FrameOverLife",
      frame: {
        type: "PiecewiseBezier",
      },
    });
    expect(validateParticleVFXEditorDraft(draft)).toEqual([]);
  });

  it("patches and disables frame-over-life animation", () => {
    const draft = createParticleVFXEditorDraftFromBlank("fire-8x8");
    const emitter = draft.emitters[0];
    const patched = applyParticleVFXEmitterPatch(draft, emitter.path, {
      frameOverLifeDraft: {
        mode: "linear",
        startFrame: 4,
        endFrame: 18,
      },
    });
    const disabled = applyParticleVFXEmitterPatch(
      patched,
      patched.emitters[0].path,
      {
        frameOverLifeDraft: {
          mode: "off",
          startFrame: 4,
          endFrame: 18,
        },
      },
    );

    expect(patched.emitters[0].frameOverLife).toEqual({
      mode: "linear",
      startFrame: 4,
      endFrame: 18,
    });
    expect(
      (
        getFirstEmitterPs(patched).behaviors as Array<Record<string, unknown>>
      ).find((behavior) => behavior.type === "FrameOverLife"),
    ).toBeTruthy();
    expect(disabled.emitters[0].frameOverLife.mode).toBe("off");
    expect(
      (
        getFirstEmitterPs(disabled).behaviors as Array<Record<string, unknown>>
      ).some((behavior) => behavior.type === "FrameOverLife"),
    ).toBe(false);
  });

  it("preserves unsupported imported frame-over-life JSON until edited", () => {
    const json = structuredClone(
      createParticleVFXEditorDraftFromBlank("fire-8x8").quarksJson,
    );
    const ps = getFirstEmitterPs({ quarksJson: json });
    const behaviors = ps.behaviors as Array<Record<string, unknown>>;
    const rawFrameOverLife = {
      type: "FrameOverLife",
      frame: {
        type: "CustomFrameCurve",
        value: "keep-me",
      },
    };
    const index = behaviors.findIndex(
      (behavior) => behavior.type === "FrameOverLife",
    );
    behaviors[index] = rawFrameOverLife;

    const imported = createParticleVFXEditorDraftFromImport(json);
    const durationPatched = applyParticleVFXEmitterPatch(
      imported,
      imported.emitters[0].path,
      { durationSec: 1.6 },
    );
    const edited = applyParticleVFXEmitterPatch(
      imported,
      imported.emitters[0].path,
      {
        frameOverLifeDraft: {
          mode: "linear",
          startFrame: 2,
          endFrame: 6,
        },
      },
    );

    expect(imported.emitters[0].frameOverLife.mode).toBe("unsupported");
    expect(
      (
        getFirstEmitterPs(durationPatched).behaviors as Array<
          Record<string, unknown>
        >
      ).find((behavior) => behavior.type === "FrameOverLife"),
    ).toEqual(rawFrameOverLife);
    expect(edited.emitters[0].frameOverLife).toEqual({
      mode: "linear",
      startFrame: 2,
      endFrame: 6,
    });
  });

  it("validates atlas tile and frame range mismatches", () => {
    const draft = createParticleVFXEditorDraftFromBlank("fire-8x8");
    const mismatch = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        renderer: {
          uTileCount: 1,
          vTileCount: 1,
        },
      },
    );
    const outOfBounds = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        frameOverLifeDraft: {
          mode: "linear",
          startFrame: 0,
          endFrame: 99,
        },
      },
    );

    expect(validateParticleVFXEditorDraft(mismatch)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "atlas-tiles-missing" }),
        expect.objectContaining({ code: "frame-range-out-of-bounds" }),
      ]),
    );
    expect(validateParticleVFXEditorDraft(outOfBounds)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "frame-range-out-of-bounds" }),
      ]),
    );
  });

  it("round-trips advanced behavior JSON through editable drafts", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const patched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        renderer: { renderMode: 2 },
        advancedBehaviors: {
          speedOverLife: {
            mode: "enabled",
            value: { mode: "linear", start: 1, end: 0.25 },
          },
          rotationOverLife: {
            mode: "enabled",
            value: { mode: "range", min: -2, max: 2 },
          },
          rotation3DOverLife: {
            mode: "axis-angle",
            axis: { x: 0, y: 1, z: 0 },
            angle: { mode: "constant", value: 0.5 },
          },
          orbitOverLife: {
            mode: "enabled",
            orbitSpeed: { mode: "constant", value: 1.5 },
            axis: { x: 0, y: 1, z: 0 },
          },
          noise: {
            mode: "enabled",
            frequency: { mode: "constant", value: 2 },
            power: { mode: "constant", value: 0.1 },
            positionAmount: { mode: "constant", value: 1 },
            rotationAmount: { mode: "constant", value: 0.2 },
          },
          turbulenceField: {
            mode: "enabled",
            scale: { x: 1, y: 2, z: 3 },
            octaves: 2,
            velocityMultiplier: { x: 0.1, y: 0.2, z: 0.3 },
            timeScale: { x: 0.4, y: 0.5, z: 0.6 },
          },
          limitSpeedOverLife: {
            mode: "enabled",
            speed: { mode: "constant", value: 0.8 },
            dampen: 0.6,
          },
        },
      },
    );
    const exported = JSON.parse(
      buildParticleVFXEditorExport(patched).quarksJson,
    ) as Record<string, unknown>;
    const imported = createParticleVFXEditorDraftFromImport(exported);
    const ps = getFirstEmitterPs(patched);
    const behaviors = ps.behaviors as Array<Record<string, unknown>>;

    expect(behaviors.map((behavior) => behavior.type)).toEqual(
      expect.arrayContaining([
        "SpeedOverLife",
        "RotationOverLife",
        "Rotation3DOverLife",
        "OrbitOverLife",
        "Noise",
        "TurbulenceField",
        "LimitSpeedOverLife",
      ]),
    );
    expect(imported.emitters[0].renderer.renderMode).toBe(2);
    expect(imported.emitters[0].advancedBehaviors).toMatchObject({
      speedOverLife: {
        mode: "enabled",
        value: { mode: "linear", start: 1, end: 0.25 },
      },
      rotation3DOverLife: {
        mode: "axis-angle",
        axis: { x: 0, y: 1, z: 0 },
      },
      orbitOverLife: {
        mode: "enabled",
        orbitSpeed: { mode: "constant", value: 1.5 },
      },
      turbulenceField: {
        mode: "enabled",
        scale: { x: 1, y: 2, z: 3 },
        octaves: 2,
      },
    });
    expect(validateParticleVFXEditorDraft(imported)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "rotation-3d-without-mesh" }),
      ]),
    );
  });

  it("preserves unsupported imported advanced behavior JSON until edited", () => {
    const json = structuredClone(
      createParticleVFXEditorDraftFromBlank().quarksJson,
    );
    const ps = getFirstEmitterPs({ quarksJson: json });
    const rawSpeedOverLife = {
      type: "SpeedOverLife",
      speed: {
        type: "CustomCurve",
        value: "keep-me",
      },
    };
    (ps.behaviors as Array<Record<string, unknown>>).push(rawSpeedOverLife);

    const imported = createParticleVFXEditorDraftFromImport(json);
    const durationPatched = applyParticleVFXEmitterPatch(
      imported,
      imported.emitters[0].path,
      { durationSec: 1.4 },
    );
    const edited = applyParticleVFXEmitterPatch(
      imported,
      imported.emitters[0].path,
      {
        advancedBehaviors: {
          speedOverLife: {
            mode: "enabled",
            value: { mode: "constant", value: 0.5 },
          },
        },
      },
    );

    expect(imported.emitters[0].advancedBehaviors.speedOverLife.mode).toBe(
      "unsupported",
    );
    expect(
      (
        getFirstEmitterPs(durationPatched).behaviors as Array<
          Record<string, unknown>
        >
      ).find((behavior) => behavior.type === "SpeedOverLife"),
    ).toEqual(rawSpeedOverLife);
    expect(edited.emitters[0].advancedBehaviors.speedOverLife).toMatchObject({
      mode: "enabled",
      value: { mode: "constant", value: 0.5 },
    });
  });

  it("supports trail renderer settings and validates behavior-mode mismatches", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const trail = applyParticleVFXEmitterPatch(draft, draft.emitters[0].path, {
      renderer: {
        renderMode: 3,
        trailStartLength: { mode: "constant", value: 18 },
        trailFollowLocalOrigin: true,
      },
      advancedBehaviors: {
        widthOverLength: {
          mode: "enabled",
          value: { mode: "linear", start: 1, end: 0 },
        },
      },
    });
    const rotation3DWithoutMesh = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        advancedBehaviors: {
          rotation3DOverLife: {
            mode: "random",
          },
        },
      },
    );
    const widthWithoutTrail = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        advancedBehaviors: {
          widthOverLength: {
            mode: "enabled",
            value: { mode: "constant", value: 1 },
          },
        },
      },
    );

    expect(trail.emitters[0].renderer).toMatchObject({
      renderMode: 3,
      trailFollowLocalOrigin: true,
      trailStartLength: { mode: "constant", value: 18 },
    });
    expect(getFirstEmitterPs(trail).rendererEmitterSettings).toMatchObject({
      startLength: { type: "ConstantValue", value: 18 },
      followLocalOrigin: true,
    });
    expect(validateParticleVFXEditorDraft(trail)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "width-over-length-without-trail" }),
      ]),
    );
    expect(validateParticleVFXEditorDraft(rotation3DWithoutMesh)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "rotation-3d-without-mesh" }),
      ]),
    );
    expect(validateParticleVFXEditorDraft(widthWithoutTrail)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "width-over-length-without-trail" }),
      ]),
    );
  });

  it("applies deterministic emitter templates", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const templated = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      { emitterTemplateId: "speed-streak" },
    );

    expect(templated.emitters[0].textureId).toBe("speed-line");
    expect(templated.emitters[0].renderer).toMatchObject({
      renderMode: 1,
      speedFactor: 0.04,
      lengthFactor: 2.2,
    });
    expect(templated.emitters[0].advancedBehaviors.speedOverLife.mode).toBe(
      "enabled",
    );
    expect(
      templated.emitters[0].advancedBehaviors.limitSpeedOverLife.mode,
    ).toBe("enabled");
    expect(buildParticleVFXEditorExport(templated).quarksJson).toContain(
      '"url": "textures/speed-line.png"',
    );
    expect(validateParticleVFXEditorDraft(templated)).toEqual([]);
  });

  it("creates editable emitter drafts from catalog quarks JSON", () => {
    const draft = createParticleVFXEditorDraftFromCatalog(
      "hearts",
      readQuarksJson(),
    );

    expect(draft.catalog.id).toBe("hearts");
    expect(draft.emitters).toHaveLength(1);
    expect(draft.emitters[0]).toMatchObject({
      name: "hearts",
      durationSec: 0.35,
      looping: false,
      worldSpace: false,
      burstCount: { min: 8, max: 8 },
      startLife: { min: 1.15, max: 1.55 },
      startSpeed: { min: 0.05, max: 0.12 },
      startSize: { min: 0.15, max: 0.24 },
    });
  });

  it("patches safe emitter-level quarks fields", () => {
    const draft = createParticleVFXEditorDraftFromCatalog(
      "hearts",
      readQuarksJson(),
    );
    const emitter = draft.emitters[0];
    const patched = applyParticleVFXEmitterPatch(draft, emitter.path, {
      durationSec: 0.5,
      looping: true,
      worldSpace: true,
      emissionOverTime: { min: 2, max: 4 },
      burstCount: { min: 11, max: 11 },
      startLife: { min: 0.8, max: 1.2 },
      startSpeed: { min: 0.2, max: 0.3 },
      startSize: { min: 0.1, max: 0.2 },
      forceOverLife: {
        y: { min: 0.4, max: 0.6 },
      },
    });

    expect(patched.emitters[0]).toMatchObject({
      durationSec: 0.5,
      looping: true,
      worldSpace: true,
      emissionOverTime: { min: 2, max: 4 },
      burstCount: { min: 11, max: 11 },
      startLife: { min: 0.8, max: 1.2 },
      startSpeed: { min: 0.2, max: 0.3 },
      startSize: { min: 0.1, max: 0.2 },
      forceOverLife: {
        y: { min: 0.4, max: 0.6 },
      },
    });
  });

  it("patches blank-draft shape, renderer, texture, burst, color, and behaviors", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const emitter = draft.emitters[0];
    const patched = applyParticleVFXEmitterPatch(draft, emitter.path, {
      name: "sparkle-pop",
      textureId: "sparkle",
      emissionOverDistance: { min: 0, max: 0.2 },
      startRotation: { min: 0.1, max: 0.5 },
      burst: {
        time: 0.08,
        count: { min: 6, max: 10 },
        interval: 0.02,
        cycle: 2,
        probability: 0.8,
      },
      startColor: { r: 0.6, g: 0.9, b: 1, a: 0.85 },
      shape: {
        type: "cone",
        radius: 0.3,
        angle: 0.45,
        thickness: 0.4,
      },
      renderer: {
        renderMode: 1,
        blending: "normal",
        opacity: 0.7,
        depthWrite: true,
        depthTest: false,
        alphaTest: 0.1,
        renderOrder: 12,
        uTileCount: 2,
        vTileCount: 3,
        blendTiles: true,
        softParticles: true,
        softNearFade: 0.2,
        softFarFade: 1.5,
        speedFactor: 0.02,
        lengthFactor: 1.4,
      },
      forceOverLifeEnabled: false,
      sizeOverLife: false,
      colorOverLife: true,
    });

    expect(patched.emitters[0]).toMatchObject({
      name: "sparkle-pop",
      textureId: "sparkle",
      textureUrl: "textures/sparkle.png",
      emissionOverDistance: { min: 0, max: 0.2 },
      startRotation: { min: 0.1, max: 0.5 },
      burst: {
        time: 0.08,
        count: { min: 6, max: 10 },
        interval: 0.02,
        cycle: 2,
        probability: 0.8,
      },
      startColor: { r: 0.6, g: 0.9, b: 1, a: 0.85 },
      shape: expect.objectContaining({
        type: "cone",
        radius: 0.3,
        angle: 0.45,
        thickness: 0.4,
      }),
      renderer: expect.objectContaining({
        renderMode: 1,
        blending: "normal",
        opacity: 0.7,
        depthWrite: true,
        depthTest: false,
        alphaTest: 0.1,
        renderOrder: 12,
        uTileCount: 2,
        vTileCount: 3,
        blendTiles: true,
        softParticles: true,
        softNearFade: 0.2,
        softFarFade: 1.5,
        speedFactor: 0.02,
        lengthFactor: 1.4,
      }),
      forceOverLife: null,
      hasSizeOverLife: false,
      hasColorOverLife: true,
    });
    expect(buildParticleVFXEditorExport(patched).quarksJson).toContain(
      '"url": "textures/sparkle.png"',
    );
  });

  it("round-trips rectangle emitter shapes through native quarks JSON", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const patched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        shape: {
          type: "rectangle",
          width: 0.8,
          height: 1.6,
          thickness: 0.35,
          mode: 1,
          spread: 0.2,
          speed: { min: 0.5, max: 0.75 },
        },
      },
    );

    const shape = getFirstEmitterPs(patched).shape as Record<string, unknown>;
    expect(shape).toMatchObject({
      type: "rectangle",
      width: 0.8,
      height: 1.6,
      thickness: 0.35,
      mode: 1,
      spread: 0.2,
      speed: { type: "IntervalValue", a: 0.5, b: 0.75 },
    });
    expect(patched.emitters[0].shape).toMatchObject({
      type: "rectangle",
      width: 0.8,
      height: 1.6,
      thickness: 0.35,
      mode: 1,
      spread: 0.2,
      speed: { min: 0.5, max: 0.75 },
    });
  });

  it("serializes fixed start colors to ConstantColor with clamped channels", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const patched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        startColorGenerator: {
          mode: "fixed",
          color: { r: 1.4, g: -0.2, b: 0.5, a: 1.7 },
        },
      },
    );

    const startColor = getFirstEmitterPs(patched).startColor as Record<
      string,
      unknown
    >;
    expect(startColor.type).toBe("ConstantColor");
    expect(startColor.color).toEqual({ r: 1, g: 0, b: 0.5, a: 1 });
    expect(patched.emitters[0].startColorGenerator).toMatchObject({
      mode: "fixed",
      color: { r: 1, g: 0, b: 0.5, a: 1 },
    });
  });

  it("serializes random range and theme start colors to ColorRange", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const rangePatched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        startColorGenerator: {
          mode: "range",
          from: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 },
          to: { r: 0.7, g: 0.8, b: 0.9, a: 1 },
        },
      },
    );
    const rangeStartColor = getFirstEmitterPs(rangePatched)
      .startColor as Record<string, unknown>;
    expect(rangeStartColor).toMatchObject({
      type: "ColorRange",
      a: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 },
      b: { r: 0.7, g: 0.8, b: 0.9, a: 1 },
    });

    const theme = PARTICLE_VFX_EDITOR_COLOR_THEME_PRESETS.find(
      (preset) => preset.id === "magic-sparkle",
    )!;
    const themePatched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        startColorGenerator: {
          mode: "theme",
          presetId: theme.id,
          from: theme.from,
          to: theme.to,
        },
      },
    );
    const themeStartColor = getFirstEmitterPs(themePatched)
      .startColor as Record<string, unknown>;
    expect(themeStartColor).toMatchObject({
      type: "ColorRange",
      a: theme.from,
      b: theme.to,
    });
  });

  it("serializes gradient color-over-life to ColorOverLife Gradient", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const patched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        colorOverLifeDraft: {
          mode: "gradient",
          stops: [
            { position: 0, color: { r: 1, g: 0, b: 0.2, a: 1 } },
            { position: 1, color: { r: 0.2, g: 0.8, b: 1, a: 0 } },
          ],
        },
      },
    );

    const behavior = getColorOverLifeBehavior(getFirstEmitterPs(patched));
    const color = behavior.color as Record<string, unknown>;
    expect(color.type).toBe("Gradient");
    expect(
      (
        (color.color as Record<string, unknown>).keys as Array<{
          value: Record<string, number>;
          pos: number;
        }>
      ).map((key) => ({ pos: key.pos, value: key.value })),
    ).toEqual([
      { pos: 0, value: { r: 1, g: 0, b: 0.2 } },
      { pos: 1, value: { r: 0.2, g: 0.8, b: 1 } },
    ]);
    expect(patched.emitters[0].colorOverLife.mode).toBe("gradient");
  });

  it("serializes randomized gradients to RandomColorBetweenGradient", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const patched = applyParticleVFXEmitterPatch(
      draft,
      draft.emitters[0].path,
      {
        colorOverLifeDraft: {
          mode: "random-gradient",
          gradientA: [
            { position: 0, color: { r: 1, g: 0.2, b: 0.4, a: 1 } },
            { position: 1, color: { r: 1, g: 0.8, b: 0.2, a: 0 } },
          ],
          gradientB: [
            { position: 0, color: { r: 0.2, g: 0.8, b: 1, a: 1 } },
            { position: 1, color: { r: 0.7, g: 0.5, b: 1, a: 0 } },
          ],
        },
      },
    );

    const behavior = getColorOverLifeBehavior(getFirstEmitterPs(patched));
    const color = behavior.color as Record<string, unknown>;
    expect(color.type).toBe("RandomColorBetweenGradient");
    expect((color.gradient1 as Record<string, unknown>).type).toBe("Gradient");
    expect((color.gradient2 as Record<string, unknown>).type).toBe("Gradient");
    expect(patched.emitters[0].colorOverLife.mode).toBe("random-gradient");
  });

  it("imports existing color generators into editable draft modes", () => {
    const json = structuredClone(
      createParticleVFXEditorDraftFromBlank().quarksJson,
    );
    const ps = getFirstEmitterPs({ quarksJson: json });
    ps.startColor = {
      type: "RandomColor",
      a: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
      b: { r: 0.6, g: 0.7, b: 0.8, a: 0.9 },
    };
    getColorOverLifeBehavior(ps).color = {
      type: "RandomColorBetweenGradient",
      gradient1: {
        type: "Gradient",
        color: {
          type: "CLinearFunction",
          subType: "Color",
          keys: [{ value: { r: 1, g: 0, b: 0.2 }, pos: 0 }],
        },
        alpha: {
          type: "CLinearFunction",
          subType: "Number",
          keys: [{ value: 1, pos: 0 }],
        },
      },
      gradient2: {
        type: "Gradient",
        color: {
          type: "CLinearFunction",
          subType: "Color",
          keys: [{ value: { r: 0.2, g: 0.8, b: 1 }, pos: 0 }],
        },
        alpha: {
          type: "CLinearFunction",
          subType: "Number",
          keys: [{ value: 0.8, pos: 0 }],
        },
      },
    };

    const imported = createParticleVFXEditorDraftFromImport(json);

    expect(imported.emitters[0].startColorGenerator).toMatchObject({
      mode: "range",
      from: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
      to: { r: 0.6, g: 0.7, b: 0.8, a: 0.9 },
    });
    expect(imported.emitters[0].colorOverLife.mode).toBe("random-gradient");
  });

  it("preserves unsupported imported color generator JSON until edited", () => {
    const json = structuredClone(
      createParticleVFXEditorDraftFromBlank().quarksJson,
    );
    const ps = getFirstEmitterPs({ quarksJson: json });
    const rawStartColor = {
      type: "CustomColorGenerator",
      nested: { value: "keep-me" },
    };
    ps.startColor = rawStartColor;

    const imported = createParticleVFXEditorDraftFromImport(json);
    const patched = applyParticleVFXEmitterPatch(
      imported,
      imported.emitters[0].path,
      { durationSec: 1.6 },
    );

    expect(imported.emitters[0].startColorGenerator.mode).toBe("unsupported");
    expect(getFirstEmitterPs(patched).startColor).toEqual(rawStartColor);
  });

  it("adds, duplicates, and removes emitters while preserving valid JSON", () => {
    const draft = createParticleVFXEditorDraftFromBlank("star");
    const added = addParticleVFXEditorEmitter(draft);
    const duplicated = duplicateParticleVFXEditorEmitter(
      added,
      added.emitters[0].path,
    );
    const removed = removeParticleVFXEditorEmitter(
      duplicated,
      duplicated.emitters[1].path,
    );

    expect(added.emitters).toHaveLength(2);
    expect(duplicated.emitters).toHaveLength(3);
    expect(duplicated.emitters[2].name).toBe("emitter-1 Copy");
    expect(removed.emitters).toHaveLength(2);
    expect(validateParticleVFXEditorDraft(removed)).toEqual([]);
  });

  it("validates remote textures, looping, world-space, and particle budgets", () => {
    const draft = createParticleVFXEditorDraftFromCatalog(
      "hearts",
      readQuarksJson(),
    );
    const json = structuredClone(draft.quarksJson);
    const images = json.images as Array<Record<string, unknown>>;
    images[0].url = "https://example.com/heart.png";
    const withRemoteTexture = createParticleVFXEditorDraftFromCatalog(
      "hearts",
      json,
    );
    const patched = applyParticleVFXEmitterPatch(
      updateParticleVFXEditorCatalogDraft(withRemoteTexture, {
        performanceBudget: {
          ...withRemoteTexture.catalog.performanceBudget,
          maxParticles: 2,
        },
      }),
      withRemoteTexture.emitters[0].path,
      {
        looping: true,
        worldSpace: true,
        burstCount: { min: 50, max: 50 },
      },
    );

    expect(validateParticleVFXEditorDraft(patched)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "remote-texture-url" }),
        expect.objectContaining({ code: "looping-not-allowed" }),
        expect.objectContaining({ code: "world-space-emitter" }),
        expect.objectContaining({ code: "particle-budget-exceeded" }),
      ]),
    );
  });

  it("accepts root-relative textures and reports embedded or unsupported texture URLs", () => {
    const baseDraft = createParticleVFXEditorDraftFromCatalog(
      "hearts",
      readQuarksJson(),
    );
    const rootRelativeJson = structuredClone(baseDraft.quarksJson);
    (rootRelativeJson.images as Array<Record<string, unknown>>)[0].url =
      "/effects/vfx/particle-vfx/textures/heart.png";
    expect(
      validateParticleVFXEditorDraft(
        createParticleVFXEditorDraftFromCatalog("hearts", rootRelativeJson),
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-texture-url" }),
        expect.objectContaining({ code: "remote-texture-url" }),
      ]),
    );

    const embeddedJson = structuredClone(baseDraft.quarksJson);
    (embeddedJson.images as Array<Record<string, unknown>>)[0].url =
      "data:image/png;base64,AAAA";
    expect(
      validateParticleVFXEditorDraft(
        createParticleVFXEditorDraftFromCatalog("hearts", embeddedJson),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "embedded-texture-url" }),
      ]),
    );

    const unsupportedJson = structuredClone(baseDraft.quarksJson);
    (unsupportedJson.images as Array<Record<string, unknown>>)[0].url =
      "ftp://example.com/heart.png";
    expect(
      validateParticleVFXEditorDraft(
        createParticleVFXEditorDraftFromCatalog("hearts", unsupportedJson),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-texture-url" }),
      ]),
    );
  });

  it("resolves relative texture paths for in-memory preview JSON", () => {
    const draft = createParticleVFXEditorDraftFromCatalog(
      "hearts",
      readQuarksJson(),
    );

    expect(
      resolveParticleVFXPublicAssetPath(
        "/effects/vfx/quark/hearts.json",
        "../particle-vfx/textures/heart.png",
      ),
    ).toBe("/effects/vfx/particle-vfx/textures/heart.png");

    const previewJson = resolveParticleVFXEditorPreviewJson(draft);
    const images = previewJson.images as Array<Record<string, unknown>>;
    expect(images[0].url).toBe("/effects/vfx/particle-vfx/textures/heart.png");
  });

  it("resolves avatar-backed creator preview placement from anchor plus offset and depth", () => {
    const avatar = createMockAvatar({
      chest: new Vector3(0, 1.1, 0.05),
    });

    const placement = resolveParticleVFXCreatorPreviewPlacement({
      avatar,
      anchor: "chest",
      transform: {
        offset: { x: 0.1, y: 0.2, z: 0.3 },
        depthOffset: 0.4,
        rotation: { x: 0.01, y: 0.02, z: 0.03 },
        scale: { x: 1.1, y: 1.2, z: 1.3 },
      },
    });

    expect(placement.resolvedAnchor).toBe("chest");
    expect(placement.boneName).toBe("chest");
    expect(placement.warning).toBeNull();
    expect(placement.autoFit).toBeNull();
    expect(placement.position.x).toBeCloseTo(0.1);
    expect(placement.position.y).toBeCloseTo(1.3);
    expect(placement.position.z).toBeCloseTo(0.75);
    expect(placement.rotation).toEqual({ x: 0.01, y: 0.02, z: 0.03 });
    expect(placement.scale).toEqual({ x: 1.1, y: 1.2, z: 1.3 });
  });

  it("resolves avatar-backed creator preview placement from avatar bounds auto-fit", () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) });
    const avatarMesh = new Mesh(
      new BoxGeometry(0.6, 1.4, 0.2),
      new MeshBasicMaterial(),
    );
    avatarMesh.position.set(0.05, 0.7, -0.02);
    avatar.scene?.add(avatarMesh);
    avatar.scene?.updateMatrixWorld(true);

    const placement = resolveParticleVFXCreatorPreviewPlacement({
      avatar,
      anchor: "head",
      transform: {
        offset: { x: 0.1, y: 0.2, z: 0.3 },
        depthOffset: 0.4,
        rotation: { x: 0.01, y: 0.02, z: 0.03 },
        scale: { x: 2, y: 1, z: 1 },
      },
      shapeAutoFit: {
        kind: "avatarBoundsRectangle",
        padding: { width: 0.2, height: 0.1 },
        minSize: { width: 0.1, height: 0.1 },
      },
    });

    expect(placement.resolvedAnchor).toBe("head");
    expect(placement.boneName).toBe("head");
    expect(placement.warning).toBeNull();
    expect(placement.autoFit?.kind).toBe("avatarBoundsRectangle");
    expect(placement.autoFit?.width).toBeCloseTo(0.4);
    expect(placement.autoFit?.height).toBeCloseTo(1.5);
    expect(placement.position.x).toBeCloseTo(0.1);
    expect(placement.position.y).toBeCloseTo(1.7);
    expect(placement.position.z).toBeCloseTo(0.7);
  });

  it("parses exact export JSON for the viewer without preview path resolution", () => {
    const draft = createParticleVFXEditorDraftFromBlank("heart");
    const exported = buildParticleVFXEditorExport(draft);

    const payload = parseParticleVFXEditorExportJsonForViewer(
      exported.quarksJson,
    );

    expect(payload.error).toBeNull();
    const images = (payload.value as Record<string, unknown>).images as Array<{
      url: string;
    }>;
    expect(images[0].url).toBe("textures/heart.png");
    expect(images[0].url).not.toBe(
      "/effects/vfx/particle-vfx/textures/heart.png",
    );
  });

  it("builds migration snippets for catalog and clip events", () => {
    const draft = updateParticleVFXEditorCatalogDraft(
      createParticleVFXEditorDraftFromCatalog("hearts", readQuarksJson()),
      {
        id: "hearts-variant",
        label: "Hearts Variant",
        assetPath: "/effects/vfx/quark/hearts-variant.json",
      },
    );
    const exported = buildParticleVFXEditorExport(draft);

    expect(exported.assetFileName).toBe("hearts-variant.json");
    expect(exported.catalogEntrySnippet).toContain('id: "hearts-variant"');
    expect(exported.catalogEntrySnippet).toContain(
      'assetPath: "/effects/vfx/quark/hearts-variant.json"',
    );
    expect(exported.clipEventSnippet).toContain('"effectId": "hearts-variant"');
  });

  it("exports avatar-bounds auto-fit as catalog metadata only", () => {
    const draft = updateParticleVFXEditorCatalogDraft(
      createParticleVFXEditorDraftFromBlank(),
      {
        shapeAutoFit: {
          kind: "avatarBoundsRectangle",
          padding: { width: 0.2, height: 0.1 },
          minSize: { width: 0.1, height: 0.1 },
          maxSize: { width: 2, height: 3 },
          emitterNames: ["body-rectangle"],
        },
      },
    );
    const exported = buildParticleVFXEditorExport(draft);

    expect(exported.catalogEntrySnippet).toContain("shapeAutoFit");
    expect(exported.catalogEntrySnippet).toContain(
      'kind: "avatarBoundsRectangle"',
    );
    expect(exported.catalogEntrySnippet).toContain(
      'emitterNames: ["body-rectangle"]',
    );
    expect(exported.quarksJson).not.toContain("shapeAutoFit");
    expect(exported.quarksJson).not.toContain("avatarBoundsRectangle");
  });
});
