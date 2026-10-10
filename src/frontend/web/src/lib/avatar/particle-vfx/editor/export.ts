import { getI18n } from "react-i18next";

import { DEFAULT_IMPORTED_CATALOG_DRAFT } from "./constants";
import { roundEditorNumber } from "./numbers";
import type {
  ParticleVFXEditorDraft,
  ParticleVFXEditorExport,
  ParticleVFXEditorExportJsonViewerPayload,
} from "./types";
import type { ParticleVFXShapeAutoFit, ParticleVFXTransform } from "../types";

export function parseParticleVFXEditorExportJsonForViewer(
  quarksJson: string | null | undefined,
): ParticleVFXEditorExportJsonViewerPayload {
  const t = getI18n().getFixedT(null, "particles");
  if (!quarksJson?.trim()) {
    return {
      value: null,
      error: t("export.unavailable"),
    };
  }

  try {
    return {
      value: JSON.parse(quarksJson) as unknown,
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error:
        error instanceof Error
          ? t("export.parseFailed", { detail: error.message })
          : t("export.parseFailedUnexplained"),
    };
  }
}

export function buildParticleVFXEditorExport(
  draft: ParticleVFXEditorDraft,
): ParticleVFXEditorExport {
  const assetPath = normalizeParticleVFXAssetPath(draft.catalog.assetPath);
  return {
    assetFileName: assetPath.split("/").at(-1) ?? `${draft.catalog.id}.json`,
    assetPath,
    quarksJson: `${JSON.stringify(draft.quarksJson, null, 2)}\n`,
    catalogEntrySnippet: buildCatalogEntrySnippet(draft, assetPath),
    clipEventSnippet: buildClipEventSnippet(draft),
  };
}

function buildCatalogEntrySnippet(
  draft: ParticleVFXEditorDraft,
  assetPath: string,
): string {
  const catalog = draft.catalog;
  return `entry({
  id: ${quote(catalog.id)},
  label: ${quote(catalog.label)},
  description: ${quote(catalog.description)},
  assetPath: ${quote(assetPath)},
  defaultAnchor: ${quote(catalog.defaultAnchor)},
  defaultFollowAnchor: ${catalog.defaultFollowAnchor},
  defaultDurationSec: ${formatNumber(catalog.defaultDurationSec)},
  defaultTransform: transform(${formatTransformInput(catalog.defaultTransform)}),
  preloadTier: ${quote(catalog.preloadTier)},
  performanceBudget: {
    maxDurationSec: ${formatNumber(catalog.performanceBudget.maxDurationSec)},
    maxParticles: ${Math.round(catalog.performanceBudget.maxParticles)},
    loopingAllowed: ${catalog.performanceBudget.loopingAllowed},
    canCoexist: ${catalog.performanceBudget.canCoexist},
  },
${formatShapeAutoFitLine(catalog.shapeAutoFit)}}),`;
}

function buildClipEventSnippet(draft: ParticleVFXEditorDraft): string {
  return `${JSON.stringify(
    {
      id: `particle-${draft.catalog.id}`,
      time: 0.1,
      kind: "particle_vfx",
      effectId: draft.catalog.id,
      anchor: draft.catalog.defaultAnchor,
      duration: draft.catalog.defaultDurationSec,
      followAnchor: true,
      transform: draft.catalog.defaultTransform,
    },
    null,
    2,
  )}\n`;
}

function formatTransformInput(transform: ParticleVFXTransform): string {
  return `{
    offset: ${formatAxisTriple(transform.offset)},
    depthOffset: ${formatNumber(transform.depthOffset)},
    rotation: ${formatAxisTriple(transform.rotation)},
    scale: ${formatAxisTriple(transform.scale)},
  }`;
}

function formatAxisTriple(value: { x: number; y: number; z: number }): string {
  return `{ x: ${formatNumber(value.x)}, y: ${formatNumber(value.y)}, z: ${formatNumber(value.z)} }`;
}

function formatShapeAutoFitLine(
  shapeAutoFit: ParticleVFXShapeAutoFit | undefined,
): string {
  if (!shapeAutoFit) return "";
  return `  shapeAutoFit: ${formatShapeAutoFit(shapeAutoFit)},\n`;
}

function formatShapeAutoFit(shapeAutoFit: ParticleVFXShapeAutoFit): string {
  const lines = [
    "{",
    `    kind: ${quote(shapeAutoFit.kind)},`,
    `    padding: ${formatSizePair(shapeAutoFit.padding, 0)},`,
    `    minSize: ${formatSizePair(shapeAutoFit.minSize, 0.1)},`,
  ];
  if (shapeAutoFit.maxSize?.width || shapeAutoFit.maxSize?.height) {
    lines.push(`    maxSize: ${formatSizePair(shapeAutoFit.maxSize, 0)},`);
  }
  if (shapeAutoFit.emitterNames?.length) {
    lines.push(
      `    emitterNames: [${shapeAutoFit.emitterNames.map(quote).join(", ")}],`,
    );
  }
  lines.push("  }");
  return lines.join("\n");
}

function formatSizePair(
  value: { width?: number; height?: number } | undefined,
  fallback: number,
): string {
  return `{ width: ${formatNumber(value?.width ?? fallback)}, height: ${formatNumber(value?.height ?? fallback)} }`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function formatNumber(value: number): string {
  return `${roundEditorNumber(value)}`;
}

function normalizeParticleVFXAssetPath(value: string): string {
  const trimmed = value.trim() || DEFAULT_IMPORTED_CATALOG_DRAFT.assetPath;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
