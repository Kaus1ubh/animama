import { createDefaultParticleVFXTransform } from "../runtime";
import type {
  ParticleVFXEditorBlending,
  ParticleVFXEditorCatalogDraft,
  ParticleVFXEditorColor,
  ParticleVFXEditorColorStop,
  ParticleVFXEditorColorThemePreset,
  ParticleVFXEditorRenderMode,
  ParticleVFXEditorShapeType,
  ParticleVFXEditorTextureEntry,
  ParticleVFXEditorTextureManifestEntry,
} from "./types";
import { PARTICLE_VFX_EDITOR_TEXTURE_MANIFEST } from "./textureManifest";

export const PARTICLE_VFX_EDITOR_TEXTURES =
  PARTICLE_VFX_EDITOR_TEXTURE_MANIFEST.map(
    texture,
  ) as readonly ParticleVFXEditorTextureEntry[];

export const PARTICLE_VFX_EDITOR_SHAPES = [
  "point",
  "sphere",
  "cone",
  "rectangle",
] as const satisfies readonly ParticleVFXEditorShapeType[];

export const PARTICLE_VFX_EDITOR_RENDER_MODES = [
  { id: "billboard", label: "Billboard", value: 0 },
  { id: "stretched", label: "Stretched Billboard", value: 1 },
  { id: "mesh", label: "Mesh", value: 2 },
  { id: "trail", label: "Trail", value: 3 },
  { id: "horizontal", label: "Horizontal Billboard", value: 4 },
  { id: "vertical", label: "Vertical Billboard", value: 5 },
] as const satisfies readonly {
  id: string;
  label: string;
  value: ParticleVFXEditorRenderMode;
}[];

export const PARTICLE_VFX_EDITOR_BLENDINGS = [
  "additive",
  "normal",
] as const satisfies readonly ParticleVFXEditorBlending[];

export const DEFAULT_IMPORTED_CATALOG_DRAFT: ParticleVFXEditorCatalogDraft = {
  id: "custom-particle-vfx",
  label: "Custom Particle VFX",
  description: "Imported particle effect.",
  assetPath: "/effects/vfx/quark/custom-particle-vfx.json",
  defaultAnchor: "head",
  defaultFollowAnchor: true,
  defaultDurationSec: 2,
  defaultTransform: createDefaultParticleVFXTransform(),
  preloadTier: "none",
  performanceBudget: {
    maxDurationSec: 3,
    maxParticles: 64,
    loopingAllowed: false,
    canCoexist: true,
  },
};

export const DEFAULT_NEW_EFFECT_ID = "custom-particle-vfx";
export const BILLBOARD_GEOMETRY_UUID =
  "animama-particle-vfx-billboard-geometry";
export const DEFAULT_TEXTURE_ID = "soft-dot";
export const FULL_CIRCLE_RADIANS = Math.PI * 2;

export const PARTICLE_VFX_EDITOR_COLOR_THEME_PRESETS: readonly ParticleVFXEditorColorThemePreset[] =
  [
    {
      id: "affection",
      label: "Affection",
      description: "Warm pinks with a soft golden tail.",
      from: editorColor(1, 0.3, 0.55, 1),
      to: editorColor(1, 0.72, 0.82, 0.92),
      gradientStops: [
        colorStop(0, 1, 0.36, 0.58, 1),
        colorStop(0.55, 1, 0.62, 0.42, 0.86),
        colorStop(1, 1, 0.86, 0.72, 0),
      ],
      randomGradientA: [
        colorStop(0, 1, 0.28, 0.5, 1),
        colorStop(1, 1, 0.82, 0.68, 0),
      ],
      randomGradientB: [
        colorStop(0, 0.98, 0.54, 0.78, 1),
        colorStop(1, 1, 0.7, 0.38, 0),
      ],
    },
    {
      id: "magic-sparkle",
      label: "Magic/Sparkle",
      description: "Cyan, violet, and soft white shimmer.",
      from: editorColor(0.35, 0.9, 1, 1),
      to: editorColor(0.86, 0.58, 1, 0.94),
      gradientStops: [
        colorStop(0, 0.28, 0.92, 1, 1),
        colorStop(0.48, 0.78, 0.48, 1, 0.9),
        colorStop(1, 1, 1, 1, 0),
      ],
      randomGradientA: [
        colorStop(0, 0.2, 0.86, 1, 1),
        colorStop(1, 0.82, 0.62, 1, 0),
      ],
      randomGradientB: [
        colorStop(0, 0.7, 0.46, 1, 1),
        colorStop(1, 0.95, 1, 1, 0),
      ],
    },
    {
      id: "surprise",
      label: "Surprise",
      description: "Bright yellow and orange burst colors.",
      from: editorColor(1, 0.9, 0.18, 1),
      to: editorColor(1, 0.42, 0.16, 0.96),
      gradientStops: [
        colorStop(0, 1, 0.95, 0.2, 1),
        colorStop(0.5, 1, 0.62, 0.18, 0.9),
        colorStop(1, 1, 0.22, 0.12, 0),
      ],
      randomGradientA: [
        colorStop(0, 1, 0.88, 0.12, 1),
        colorStop(1, 1, 0.42, 0.08, 0),
      ],
      randomGradientB: [
        colorStop(0, 1, 0.68, 0.16, 1),
        colorStop(1, 1, 0.96, 0.42, 0),
      ],
    },
    {
      id: "sadness",
      label: "Sadness",
      description: "Cool blue and lavender rain tones.",
      from: editorColor(0.22, 0.52, 1, 0.94),
      to: editorColor(0.58, 0.74, 1, 0.82),
      gradientStops: [
        colorStop(0, 0.22, 0.52, 1, 0.95),
        colorStop(0.62, 0.42, 0.72, 1, 0.72),
        colorStop(1, 0.74, 0.82, 1, 0),
      ],
      randomGradientA: [
        colorStop(0, 0.18, 0.46, 1, 0.95),
        colorStop(1, 0.5, 0.72, 1, 0),
      ],
      randomGradientB: [
        colorStop(0, 0.4, 0.56, 0.95, 0.92),
        colorStop(1, 0.7, 0.82, 1, 0),
      ],
    },
    {
      id: "sleep",
      label: "Sleep",
      description: "Dim moonlit blue and purple haze.",
      from: editorColor(0.36, 0.42, 0.86, 0.86),
      to: editorColor(0.72, 0.58, 1, 0.72),
      gradientStops: [
        colorStop(0, 0.36, 0.42, 0.86, 0.86),
        colorStop(0.58, 0.56, 0.5, 0.96, 0.64),
        colorStop(1, 0.82, 0.78, 1, 0),
      ],
      randomGradientA: [
        colorStop(0, 0.28, 0.36, 0.78, 0.86),
        colorStop(1, 0.68, 0.64, 1, 0),
      ],
      randomGradientB: [
        colorStop(0, 0.48, 0.42, 0.9, 0.8),
        colorStop(1, 0.86, 0.82, 1, 0),
      ],
    },
    {
      id: "neutral-soft",
      label: "Neutral/Soft",
      description: "Pearl, mint, and pale sky utility colors.",
      from: editorColor(0.84, 0.94, 1, 0.9),
      to: editorColor(0.86, 1, 0.9, 0.78),
      gradientStops: [
        colorStop(0, 0.82, 0.94, 1, 0.9),
        colorStop(0.55, 0.88, 1, 0.92, 0.68),
        colorStop(1, 1, 1, 1, 0),
      ],
      randomGradientA: [
        colorStop(0, 0.78, 0.92, 1, 0.9),
        colorStop(1, 1, 1, 1, 0),
      ],
      randomGradientB: [
        colorStop(0, 0.82, 1, 0.88, 0.84),
        colorStop(1, 0.94, 0.98, 1, 0),
      ],
    },
  ];

function texture(
  entry: ParticleVFXEditorTextureManifestEntry,
): ParticleVFXEditorTextureEntry {
  return {
    ...entry,
    relativeUrl: `textures/${entry.fileName}`,
    publicUrl: `/effects/vfx/particle-vfx/textures/${entry.fileName}`,
  };
}

function editorColor(
  r: number,
  g: number,
  b: number,
  a: number,
): ParticleVFXEditorColor {
  return { r, g, b, a };
}

function colorStop(
  position: number,
  r: number,
  g: number,
  b: number,
  a: number,
): ParticleVFXEditorColorStop {
  return { position, color: editorColor(r, g, b, a) };
}
