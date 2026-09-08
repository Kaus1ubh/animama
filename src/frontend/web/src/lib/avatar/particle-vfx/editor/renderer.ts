import { ensureJsonObjectProperty, readJsonObject } from "./json";
import { readFiniteNumber, roundEditorNumber } from "./numbers";
import { ensureEmitterMaterial, readEmitterMaterial } from "./textures";
import {
  readValueGeneratorDraft,
  valueGeneratorDraftToJson,
} from "./advancedBehaviors";
import type {
  JsonObject,
  ParticleVFXEditorRenderMode,
  ParticleVFXEditorRendererDraft,
} from "./types";

export function readRendererDraft(
  quarksJson: JsonObject,
  ps: JsonObject | null | undefined,
): ParticleVFXEditorRendererDraft {
  const material = ps ? readEmitterMaterial(quarksJson, ps) : null;
  const renderMode = readFiniteNumber(ps?.renderMode);
  const rendererSettings = readJsonObject(ps?.rendererEmitterSettings);
  return {
    renderMode: renderMode ?? 0,
    blending: material?.blending === 1 ? "normal" : "additive",
    opacity: readFiniteNumber(material?.opacity) ?? 1,
    depthWrite: material?.depthWrite === true,
    depthTest: material?.depthTest !== false,
    alphaTest: readFiniteNumber(material?.alphaTest) ?? 0,
    renderOrder: readFiniteNumber(ps?.renderOrder) ?? 0,
    uTileCount: Math.max(1, Math.round(readFiniteNumber(ps?.uTileCount) ?? 1)),
    vTileCount: Math.max(1, Math.round(readFiniteNumber(ps?.vTileCount) ?? 1)),
    blendTiles: ps?.blendTiles === true,
    softParticles: ps?.softParticles === true,
    softNearFade: readFiniteNumber(ps?.softNearFade) ?? 0,
    softFarFade: readFiniteNumber(ps?.softFarFade) ?? 0,
    speedFactor: readFiniteNumber(rendererSettings?.speedFactor) ?? 0.01,
    lengthFactor: readFiniteNumber(rendererSettings?.lengthFactor) ?? 1,
    trailStartLength: readValueGeneratorDraft(
      rendererSettings?.startLength,
      30,
    ),
    trailFollowLocalOrigin: rendererSettings?.followLocalOrigin === true,
  };
}

export function patchRenderer(
  quarksJson: JsonObject,
  ps: JsonObject,
  patch: Partial<ParticleVFXEditorRendererDraft>,
): void {
  const material = ensureEmitterMaterial(quarksJson, ps);
  if (typeof patch.renderMode === "number") {
    ps.renderMode = patch.renderMode;
    if (patch.renderMode === 3) {
      ps.rendererEmitterSettings = {
        startLength:
          readJsonObject(ps.rendererEmitterSettings)?.startLength ??
          valueGeneratorDraftToJson(readValueGeneratorDraft(null, 30)),
        followLocalOrigin:
          readJsonObject(ps.rendererEmitterSettings)?.followLocalOrigin ===
          true,
      };
    } else if (patch.renderMode === 1) {
      const current = readJsonObject(ps.rendererEmitterSettings);
      ps.rendererEmitterSettings = {
        speedFactor: readFiniteNumber(current?.speedFactor) ?? 0.01,
        lengthFactor: readFiniteNumber(current?.lengthFactor) ?? 1,
      };
    } else if (
      patch.renderMode === 0 ||
      patch.renderMode === 2 ||
      patch.renderMode === 4 ||
      patch.renderMode === 5
    ) {
      ps.rendererEmitterSettings = {};
    }
  }
  if (patch.blending) {
    material.blending = patch.blending === "normal" ? 1 : 2;
  }
  if (typeof patch.opacity === "number") {
    material.opacity = roundEditorNumber(
      Math.min(1, Math.max(0, patch.opacity)),
    );
    material.transparent = true;
  }
  if (typeof patch.depthWrite === "boolean") {
    material.depthWrite = patch.depthWrite;
  }
  if (typeof patch.depthTest === "boolean") {
    material.depthTest = patch.depthTest;
  }
  if (typeof patch.alphaTest === "number") {
    material.alphaTest = roundEditorNumber(
      Math.min(1, Math.max(0, patch.alphaTest)),
    );
  }
  if (typeof patch.renderOrder === "number") {
    ps.renderOrder = Math.round(patch.renderOrder);
  }
  if (typeof patch.uTileCount === "number") {
    ps.uTileCount = Math.max(1, Math.round(patch.uTileCount));
  }
  if (typeof patch.vTileCount === "number") {
    ps.vTileCount = Math.max(1, Math.round(patch.vTileCount));
  }
  if (typeof patch.blendTiles === "boolean") {
    ps.blendTiles = patch.blendTiles;
  }
  if (typeof patch.softParticles === "boolean") {
    ps.softParticles = patch.softParticles;
  }
  if (typeof patch.softNearFade === "number") {
    ps.softNearFade = roundEditorNumber(Math.max(0, patch.softNearFade));
  }
  if (typeof patch.softFarFade === "number") {
    ps.softFarFade = roundEditorNumber(Math.max(0, patch.softFarFade));
  }
  if (
    typeof patch.speedFactor === "number" ||
    typeof patch.lengthFactor === "number"
  ) {
    const settings = ensureJsonObjectProperty(ps, "rendererEmitterSettings");
    if (typeof patch.speedFactor === "number") {
      settings.speedFactor = roundEditorNumber(Math.max(0, patch.speedFactor));
    }
    if (typeof patch.lengthFactor === "number") {
      settings.lengthFactor = roundEditorNumber(
        Math.max(0, patch.lengthFactor),
      );
    }
  }
  if (patch.trailStartLength) {
    const settings = ensureJsonObjectProperty(ps, "rendererEmitterSettings");
    settings.startLength = valueGeneratorDraftToJson(patch.trailStartLength);
  }
  if (typeof patch.trailFollowLocalOrigin === "boolean") {
    const settings = ensureJsonObjectProperty(ps, "rendererEmitterSettings");
    settings.followLocalOrigin = patch.trailFollowLocalOrigin;
  }
}

export function isSupportedRenderMode(
  renderMode: unknown,
): renderMode is ParticleVFXEditorRenderMode {
  return (
    renderMode === 0 ||
    renderMode === 1 ||
    renderMode === 2 ||
    renderMode === 3 ||
    renderMode === 4 ||
    renderMode === 5
  );
}
