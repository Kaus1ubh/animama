import { getI18n } from "react-i18next";

import { isParticleVFXAnchor } from "../runtime";
import { collectEmitterNodes } from "./emitters";
import { readJsonObject } from "./json";
import { isSupportedRenderMode } from "./renderer";
import {
  classifyParticleVFXTextureUrl,
  getParticleVFXEditorTextureById,
} from "./textures";
import {
  getUnsupportedAdvancedBehaviorLabels,
  particleVFXQuarksTypeLabel,
} from "./advancedBehaviors";
import type {
  ParticleVFXEditorDraft,
  ParticleVFXEditorValidationIssue,
} from "./types";

/**
 * Check a creator draft. Messages are worded in `language`, by default the
 * active UI Locale.
 */
export function validateParticleVFXEditorDraft(
  draft: ParticleVFXEditorDraft,
  language?: string,
): ParticleVFXEditorValidationIssue[] {
  const t = getI18n().getFixedT(language ?? null, "particles");
  const issues: ParticleVFXEditorValidationIssue[] = [];
  const object = readJsonObject(draft.quarksJson.object);
  if (!object) {
    issues.push({
      severity: "error",
      code: "missing-object",
      message: t("issues.missingObject"),
      target: "object",
    });
  }
  if (draft.emitters.length === 0) {
    issues.push({
      severity: "error",
      code: "missing-emitter",
      message: t("issues.missingEmitter"),
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
      message: t("issues.missingTexture"),
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
        message: t("issues.emptyTextureUrl"),
        target,
      });
      return;
    }
    const classification = classifyParticleVFXTextureUrl(url);
    if (classification === "remote") {
      issues.push({
        severity: "error",
        code: "remote-texture-url",
        message: t("issues.remoteTextureUrl"),
        target,
      });
    } else if (classification === "embedded") {
      issues.push({
        severity: "warning",
        code: "embedded-texture-url",
        message: t("issues.embeddedTextureUrl"),
        target,
      });
    } else if (classification === "blob") {
      issues.push({
        severity: "error",
        code: "blob-texture-url",
        message: t("issues.blobTextureUrl"),
        target,
      });
    } else if (classification === "unsupported") {
      issues.push({
        severity: "error",
        code: "invalid-texture-url",
        message: t("issues.unsupportedTextureUrl"),
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
        message: t("issues.invalidEmitterAnchor"),
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
        message: t("issues.invalidDuration"),
        target,
      });
    } else if (
      emitter.durationSec > draft.catalog.performanceBudget.maxDurationSec
    ) {
      issues.push({
        severity: "warning",
        code: "duration-over-budget",
        message: t("issues.durationOverBudget"),
        target,
      });
    }
    if (emitter.looping && !draft.catalog.performanceBudget.loopingAllowed) {
      issues.push({
        severity: "error",
        code: "looping-not-allowed",
        message: t("issues.loopingNotAllowed"),
        target,
      });
    }
    if (emitter.worldSpace) {
      issues.push({
        severity: "warning",
        code: "world-space-emitter",
        message: t("issues.worldSpaceEmitter"),
        target,
      });
    }
    if (emitter.shape.type === "unsupported") {
      issues.push({
        severity: "warning",
        code: "unsupported-shape",
        message: t("issues.unsupportedShape"),
        target,
      });
    }
    if (!isSupportedRenderMode(emitter.renderer.renderMode)) {
      issues.push({
        severity: "warning",
        code: "unsupported-render-mode",
        message: t("issues.unsupportedRenderMode"),
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
        message: t("issues.unsupportedBehaviorSettings", {
          items: [...new Set(unsupportedBehaviorLabels)].map((label) =>
            particleVFXQuarksTypeLabel(label, language),
          ),
        }),
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
        message: t("issues.trailSettingsMissing"),
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
        message: t("issues.widthOverLengthWithoutTrail"),
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
        message: t("issues.rotation3DWithoutMesh"),
        target,
      });
    }
    const texture = emitter.textureId
      ? getParticleVFXEditorTextureById(emitter.textureId)
      : null;
    const atlas = texture?.atlas;
    const tileCapacity =
      emitter.renderer.uTileCount * emitter.renderer.vTileCount;
    if (atlas) {
      if (
        emitter.renderer.uTileCount === 1 &&
        emitter.renderer.vTileCount === 1
      ) {
        issues.push({
          severity: "warning",
          code: "atlas-tiles-missing",
          message: t("issues.atlasTilesMissing"),
          target,
        });
      } else if (
        emitter.renderer.uTileCount !== atlas.uTileCount ||
        emitter.renderer.vTileCount !== atlas.vTileCount
      ) {
        issues.push({
          severity: "warning",
          code: "atlas-metadata-mismatch",
          message: t("issues.atlasMetadataMismatch"),
          target,
        });
      }
    }
    if (emitter.frameOverLife.mode !== "off") {
      if (!atlas) {
        issues.push({
          severity: "warning",
          code: "frame-over-life-without-atlas",
          message: t("issues.frameAnimationWithoutAtlas"),
          target,
        });
      } else if (tileCapacity <= 1) {
        issues.push({
          severity: "warning",
          code: "frame-over-life-without-atlas",
          message: t("issues.frameAnimationNeedsTiles"),
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
          message: t("issues.frameRangeOutOfBounds"),
          target,
        });
      }
    }
  }

  const estimatedParticles = estimateParticleVFXDraftParticles(draft);
  if (estimatedParticles > draft.catalog.performanceBudget.maxParticles) {
    issues.push({
      severity: "warning",
      code: "particle-budget-exceeded",
      message: t("issues.particleBudgetExceeded", {
        estimated: estimatedParticles,
        budget: draft.catalog.performanceBudget.maxParticles,
      }),
      target: "performanceBudget.maxParticles",
    });
  }

  return issues;
}

export function estimateParticleVFXDraftParticles(
  draft: ParticleVFXEditorDraft,
): number {
  return draft.emitters.reduce((total, emitter) => {
    const duration = Math.max(0, emitter.durationSec ?? 0);
    const emissionOverTime = Math.max(0, emitter.emissionOverTime?.max ?? 0);
    const burstCount = Math.max(0, emitter.burstCount?.max ?? 0);
    return total + Math.ceil(duration * emissionOverTime + burstCount);
  }, 0);
}
