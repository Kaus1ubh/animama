import { PARTICLE_TEXTURE_LIMITS } from "@/lib/effects/effectArtLimits";
import { isParticleVFXAnchor } from "../runtime";
import { collectEmitterNodes } from "./emitters";
import { readJsonObject } from "./json";
import { estimateParticleVFXParticles } from "./particleEstimate";
import { isSupportedRenderMode } from "./renderer";
import {
  classifyParticleVFXTextureUrl,
  getParticleVFXEditorTextureById,
} from "./textures";
import { getUnsupportedAdvancedBehaviorLabels } from "./advancedBehaviors";
import type {
  ParticleVFXEditorDraft,
  ParticleVFXEditorValidationIssue,
} from "./types";

export function validateParticleVFXEditorDraft(
  draft: ParticleVFXEditorDraft,
): ParticleVFXEditorValidationIssue[] {
  const issues: ParticleVFXEditorValidationIssue[] = [];
  const object = readJsonObject(draft.quarksJson.object);
  if (!object) {
    issues.push({
      severity: "error",
      code: "missing-object",
      message: "Quarks JSON must include an object root.",
      target: "object",
    });
  }
  if (draft.emitters.length === 0) {
    issues.push({
      severity: "error",
      code: "missing-emitter",
      message: "Quarks JSON must include at least one ParticleEmitter.",
      target: "object.children",
    });
  }

  const images = Array.isArray(draft.quarksJson.images)
    ? draft.quarksJson.images
    : [];
  if (images.length === 0) {
    issues.push({
      severity: "error",
      code: "missing-texture",
      message: "Quarks JSON must include at least one texture image.",
      target: "images",
    });
  }
  images.forEach((image, index) => {
    const url = readJsonObject(image)?.url;
    const target = `images.${index}.url`;
    if (typeof url !== "string" || url.trim().length === 0) {
      issues.push({
        severity: "error",
        code: "invalid-texture-url",
        message: "Texture image URL must be a non-empty string.",
        target,
      });
      return;
    }
    const classification = classifyParticleVFXTextureUrl(url);
    if (classification === "remote") {
      issues.push({
        severity: "error",
        code: "remote-texture-url",
        message: "Remote texture URLs are not allowed in shipped VFX assets.",
        target,
      });
    } else if (classification === "embedded") {
      issues.push({
        severity: "warning",
        code: "embedded-texture-url",
        message:
          "This embedded texture is not a PNG the effect can carry; replace it with an imported texture.",
        target,
      });
    } else if (classification === "blob") {
      issues.push({
        severity: "error",
        code: "blob-texture-url",
        message: "Blob texture URLs are preview-only and cannot be exported.",
        target,
      });
    } else if (classification === "unsupported") {
      issues.push({
        severity: "error",
        code: "invalid-texture-url",
        message:
          "Texture URL must be relative, root-relative, data:image, or blob.",
        target,
      });
    }
  });

  for (const { object: node, path } of collectEmitterNodes(draft.quarksJson)) {
    const anchor = readJsonObject(node.userData)?.animamaParticleAnchor;
    if (anchor !== undefined && !isParticleVFXAnchor(anchor)) {
      issues.push({
        severity: "error",
        code: "invalid-emitter-anchor",
        message: "Choose a supported emitter anchor or Inherit.",
        target: path,
      });
    }
  }

  for (const emitter of draft.emitters) {
    const target = `emitter:${emitter.name}`;
    if (!emitter.durationSec || emitter.durationSec <= 0) {
      issues.push({
        severity: "error",
        code: "invalid-duration",
        message: "Emitter duration must be greater than zero.",
        target,
      });
    } else if (
      emitter.durationSec > draft.catalog.performanceBudget.maxDurationSec
    ) {
      issues.push({
        severity: "warning",
        code: "duration-over-budget",
        message: "Emitter duration exceeds the catalog max duration budget.",
        target,
      });
    }
    if (emitter.looping && !draft.catalog.performanceBudget.loopingAllowed) {
      issues.push({
        severity: "error",
        code: "looping-not-allowed",
        message: "Looping emitters are not allowed by this catalog budget.",
        target,
      });
    }
    if (emitter.worldSpace) {
      issues.push({
        severity: "warning",
        code: "world-space-emitter",
        message:
          "World-space emitters spawn at the anchor but do not continuously follow it.",
        target,
      });
    }
    if (emitter.shape.type === "unsupported") {
      issues.push({
        severity: "warning",
        code: "unsupported-shape",
        message: "This emitter uses a shape that the creator cannot edit.",
        target,
      });
    }
    if (!isSupportedRenderMode(emitter.renderer.renderMode)) {
      issues.push({
        severity: "warning",
        code: "unsupported-render-mode",
        message:
          "This emitter uses a render mode that the creator cannot edit.",
        target,
      });
    }
    const unsupportedBehaviorLabels = getUnsupportedAdvancedBehaviorLabels(
      emitter.advancedBehaviors,
    );
    if (unsupportedBehaviorLabels.length > 0) {
      issues.push({
        severity: "warning",
        code: "unsupported-behavior-settings",
        message: `Advanced behavior settings are preserved but not fully editable: ${[
          ...new Set(unsupportedBehaviorLabels),
        ].join(", ")}.`,
        target,
      });
    }
    if (
      emitter.renderer.renderMode === 3 &&
      emitter.renderer.trailStartLength.mode === "unsupported"
    ) {
      issues.push({
        severity: "warning",
        code: "trail-settings-missing",
        message: "Trail render mode needs an editable start length generator.",
        target,
      });
    }
    if (
      emitter.advancedBehaviors.widthOverLength.mode !== "off" &&
      emitter.renderer.renderMode !== 3
    ) {
      issues.push({
        severity: "warning",
        code: "width-over-length-without-trail",
        message: "WidthOverLength only affects Trail render mode.",
        target,
      });
    }
    if (
      emitter.advancedBehaviors.rotation3DOverLife.mode !== "off" &&
      emitter.renderer.renderMode !== 2
    ) {
      issues.push({
        severity: "warning",
        code: "rotation-3d-without-mesh",
        message: "Rotation3DOverLife needs Mesh render mode to preview.",
        target,
      });
    }
    const texture = emitter.textureId
      ? getParticleVFXEditorTextureById(emitter.textureId)
      : null;
    const atlas = texture?.atlas;
    // An imported sheet has no built-in metadata: its tile counts are its atlas.
    const carriedTexture = !texture && Boolean(emitter.textureUrl);
    const tileCapacity =
      emitter.renderer.uTileCount * emitter.renderer.vTileCount;
    const maxGrid = PARTICLE_TEXTURE_LIMITS.grid;
    if (
      [emitter.renderer.uTileCount, emitter.renderer.vTileCount].some(
        (count) => !Number.isInteger(count) || count < 1 || count > maxGrid,
      )
    ) {
      issues.push({
        severity: "error",
        code: "atlas-grid-limit",
        message: `Sprite sheets have 1 to ${maxGrid} tiles in each direction.`,
        target,
      });
    }
    if (atlas) {
      if (
        emitter.renderer.uTileCount === 1 &&
        emitter.renderer.vTileCount === 1
      ) {
        issues.push({
          severity: "warning",
          code: "atlas-tiles-missing",
          message:
            "Selected atlas texture should use more than one tile in the renderer.",
          target,
        });
      } else if (
        emitter.renderer.uTileCount !== atlas.uTileCount ||
        emitter.renderer.vTileCount !== atlas.vTileCount
      ) {
        issues.push({
          severity: "warning",
          code: "atlas-metadata-mismatch",
          message:
            "Renderer tile counts do not match the selected atlas texture metadata.",
          target,
        });
      }
    }
    if (emitter.frameOverLife.mode !== "off") {
      if (!atlas && !carriedTexture) {
        issues.push({
          severity: "warning",
          code: "frame-over-life-without-atlas",
          message:
            "Frame animation is enabled but the selected texture is not an atlas.",
          target,
        });
      } else if (tileCapacity <= 1) {
        issues.push({
          severity: "warning",
          code: "frame-over-life-without-atlas",
          message: "Frame animation needs more than one renderer tile.",
          target,
        });
      }
      const maxFrame = Math.max(
        0,
        Math.min(atlas?.frameCount ?? tileCapacity, tileCapacity) - 1,
      );
      if (
        emitter.frameOverLife.startFrame > maxFrame ||
        emitter.frameOverLife.endFrame > maxFrame
      ) {
        issues.push({
          severity: "warning",
          code: "frame-range-out-of-bounds",
          message:
            "Frame animation range exceeds the selected atlas texture frames.",
          target,
        });
      }
    }
  }

  // The estimate Save enforces: Save's readiness check promotes this warning
  // to an error, so the creator and Save state the same numbers.
  const estimatedParticles = estimateParticleVFXParticles(draft.quarksJson);
  const budget = draft.catalog.performanceBudget.maxParticles;
  if (estimatedParticles > budget) {
    issues.push({
      severity: "warning",
      code: "particle-budget-exceeded",
      message: Number.isFinite(estimatedParticles)
        ? `Estimated ${estimatedParticles} particles exceeds the catalog budget of ${budget}.`
        : `Particle use cannot be estimated (an emission, burst or duration value is unsupported); the catalog budget is ${budget}.`,
      target: "performanceBudget.maxParticles",
    });
  }

  return issues;
}
