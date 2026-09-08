import type {
  ParticleVFXAnchor,
  ParticleVFXPerformanceBudget,
  ParticleVFXPreloadTier,
  ParticleVFXShapeAutoFit,
  ParticleVFXTransform,
  ParticleVFXTransformAxisTriple,
} from "../types";

export type JsonObject = Record<string, unknown>;
export type JsonArray = unknown[];

export type ParticleVFXEditorShapeType =
  | "point"
  | "sphere"
  | "cone"
  | "rectangle";

export type ParticleVFXEditorEmitterMode = 0 | 1 | 2 | 3;

export type ParticleVFXEditorRenderMode = 0 | 1 | 2 | 3 | 4 | 5;

export type ParticleVFXEditorBlending = "normal" | "additive";

export type ParticleVFXEditorTextureRole =
  | "glow"
  | "spark"
  | "smoke"
  | "trail"
  | "symbol";

export type ParticleVFXEditorFrameOverLifePreset = {
  startFrame: number;
  endFrame: number;
};

export type ParticleVFXEditorTextureAtlas = {
  uTileCount: number;
  vTileCount: number;
  frameCount?: number;
  blendTiles?: boolean;
  frameOverLife?: ParticleVFXEditorFrameOverLifePreset;
};

export type ParticleVFXEditorTextureManifestEntry = {
  id: string;
  label: string;
  fileName: string;
  role: ParticleVFXEditorTextureRole;
  recommendedBlending: ParticleVFXEditorBlending;
  recommendedRenderMode: ParticleVFXEditorRenderMode;
  atlas?: ParticleVFXEditorTextureAtlas;
};

export type ParticleVFXEditorTextureEntry =
  ParticleVFXEditorTextureManifestEntry & {
    relativeUrl: string;
    publicUrl: string;
  };

export type ParticleVFXEditorValueRange = {
  min: number;
  max: number;
};

export type ParticleVFXEditorValueGeneratorDraft =
  | {
      mode: "constant";
      value: number;
    }
  | {
      mode: "range";
      min: number;
      max: number;
    }
  | {
      mode: "linear";
      start: number;
      end: number;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      fallbackValue: number;
    };

export type ParticleVFXEditorValueBehaviorDraft =
  | {
      mode: "off";
      value: ParticleVFXEditorValueGeneratorDraft;
    }
  | {
      mode: "enabled";
      value: ParticleVFXEditorValueGeneratorDraft;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      value: ParticleVFXEditorValueGeneratorDraft;
    };

export type ParticleVFXEditorLimitSpeedOverLifeDraft =
  | {
      mode: "off";
      speed: ParticleVFXEditorValueGeneratorDraft;
      dampen: number;
    }
  | {
      mode: "enabled";
      speed: ParticleVFXEditorValueGeneratorDraft;
      dampen: number;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      speed: ParticleVFXEditorValueGeneratorDraft;
      dampen: number;
    };

export type ParticleVFXEditorOrbitOverLifeDraft =
  | {
      mode: "off";
      orbitSpeed: ParticleVFXEditorValueGeneratorDraft;
      axis: ParticleVFXTransformAxisTriple;
    }
  | {
      mode: "enabled";
      orbitSpeed: ParticleVFXEditorValueGeneratorDraft;
      axis: ParticleVFXTransformAxisTriple;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      orbitSpeed: ParticleVFXEditorValueGeneratorDraft;
      axis: ParticleVFXTransformAxisTriple;
    };

export type ParticleVFXEditorNoiseDraft =
  | {
      mode: "off";
      frequency: ParticleVFXEditorValueGeneratorDraft;
      power: ParticleVFXEditorValueGeneratorDraft;
      positionAmount: ParticleVFXEditorValueGeneratorDraft;
      rotationAmount: ParticleVFXEditorValueGeneratorDraft;
    }
  | {
      mode: "enabled";
      frequency: ParticleVFXEditorValueGeneratorDraft;
      power: ParticleVFXEditorValueGeneratorDraft;
      positionAmount: ParticleVFXEditorValueGeneratorDraft;
      rotationAmount: ParticleVFXEditorValueGeneratorDraft;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      frequency: ParticleVFXEditorValueGeneratorDraft;
      power: ParticleVFXEditorValueGeneratorDraft;
      positionAmount: ParticleVFXEditorValueGeneratorDraft;
      rotationAmount: ParticleVFXEditorValueGeneratorDraft;
    };

export type ParticleVFXEditorTurbulenceFieldDraft =
  | {
      mode: "off";
      scale: ParticleVFXTransformAxisTriple;
      octaves: number;
      velocityMultiplier: ParticleVFXTransformAxisTriple;
      timeScale: ParticleVFXTransformAxisTriple;
    }
  | {
      mode: "enabled";
      scale: ParticleVFXTransformAxisTriple;
      octaves: number;
      velocityMultiplier: ParticleVFXTransformAxisTriple;
      timeScale: ParticleVFXTransformAxisTriple;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      scale: ParticleVFXTransformAxisTriple;
      octaves: number;
      velocityMultiplier: ParticleVFXTransformAxisTriple;
      timeScale: ParticleVFXTransformAxisTriple;
    };

export type ParticleVFXEditorRotation3DOverLifeDraft =
  | {
      mode: "off";
    }
  | {
      mode: "axis-angle";
      axis: ParticleVFXTransformAxisTriple;
      angle: ParticleVFXEditorValueGeneratorDraft;
    }
  | {
      mode: "euler";
      angleX: ParticleVFXEditorValueGeneratorDraft;
      angleY: ParticleVFXEditorValueGeneratorDraft;
      angleZ: ParticleVFXEditorValueGeneratorDraft;
      eulerOrder: string;
    }
  | {
      mode: "random";
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
    };

export type ParticleVFXEditorAdvancedBehaviorsDraft = {
  speedOverLife: ParticleVFXEditorValueBehaviorDraft;
  rotationOverLife: ParticleVFXEditorValueBehaviorDraft;
  rotation3DOverLife: ParticleVFXEditorRotation3DOverLifeDraft;
  orbitOverLife: ParticleVFXEditorOrbitOverLifeDraft;
  noise: ParticleVFXEditorNoiseDraft;
  turbulenceField: ParticleVFXEditorTurbulenceFieldDraft;
  limitSpeedOverLife: ParticleVFXEditorLimitSpeedOverLifeDraft;
  widthOverLength: ParticleVFXEditorValueBehaviorDraft;
};

export type ParticleVFXEditorEmitterTemplateId =
  | "pop"
  | "aura"
  | "smoke-fade"
  | "speed-streak"
  | "sparkle-burst";

export type ParticleVFXEditorColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type ParticleVFXEditorColorThemePresetId =
  | "affection"
  | "magic-sparkle"
  | "surprise"
  | "sadness"
  | "sleep"
  | "neutral-soft";

export type ParticleVFXEditorColorStop = {
  position: number;
  color: ParticleVFXEditorColor;
};

export type ParticleVFXEditorStartColorDraft =
  | {
      mode: "fixed";
      color: ParticleVFXEditorColor;
    }
  | {
      mode: "range";
      from: ParticleVFXEditorColor;
      to: ParticleVFXEditorColor;
    }
  | {
      mode: "theme";
      presetId: ParticleVFXEditorColorThemePresetId;
      from: ParticleVFXEditorColor;
      to: ParticleVFXEditorColor;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      fallbackColor: ParticleVFXEditorColor;
      label: string;
    };

export type ParticleVFXEditorColorOverLifeDraft =
  | {
      mode: "off";
    }
  | {
      mode: "fade";
      stops: ParticleVFXEditorColorStop[];
    }
  | {
      mode: "gradient";
      stops: ParticleVFXEditorColorStop[];
    }
  | {
      mode: "random-gradient";
      gradientA: ParticleVFXEditorColorStop[];
      gradientB: ParticleVFXEditorColorStop[];
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
    };

export type ParticleVFXEditorFrameOverLifeDraft =
  | {
      mode: "off";
      startFrame: number;
      endFrame: number;
    }
  | {
      mode: "linear";
      startFrame: number;
      endFrame: number;
    }
  | {
      mode: "unsupported";
      raw: JsonObject;
      label: string;
      startFrame: number;
      endFrame: number;
    };

export type ParticleVFXEditorColorThemePreset = {
  id: ParticleVFXEditorColorThemePresetId;
  label: string;
  description: string;
  from: ParticleVFXEditorColor;
  to: ParticleVFXEditorColor;
  gradientStops: ParticleVFXEditorColorStop[];
  randomGradientA: ParticleVFXEditorColorStop[];
  randomGradientB: ParticleVFXEditorColorStop[];
};

export type ParticleVFXEditorBurstDraft = {
  time: number;
  count: ParticleVFXEditorValueRange;
  interval: number;
  cycle: number;
  probability: number;
};

export type ParticleVFXEditorShapeDraft = {
  type: ParticleVFXEditorShapeType | "unsupported";
  radius: number;
  width: number;
  height: number;
  arc: number;
  thickness: number;
  angle: number;
  mode: ParticleVFXEditorEmitterMode;
  spread: number;
  speed: ParticleVFXEditorValueRange;
};

export type ParticleVFXEditorRendererDraft = {
  renderMode: number;
  blending: ParticleVFXEditorBlending;
  opacity: number;
  depthWrite: boolean;
  depthTest: boolean;
  alphaTest: number;
  renderOrder: number;
  uTileCount: number;
  vTileCount: number;
  blendTiles: boolean;
  softParticles: boolean;
  softNearFade: number;
  softFarFade: number;
  speedFactor: number;
  lengthFactor: number;
  trailStartLength: ParticleVFXEditorValueGeneratorDraft;
  trailFollowLocalOrigin: boolean;
};

export type ParticleVFXEmitterDraft = {
  path: string;
  uuid: string | null;
  name: string;
  localPosition: ParticleVFXTransformAxisTriple;
  durationSec: number | null;
  looping: boolean;
  worldSpace: boolean;
  emissionOverTime: ParticleVFXEditorValueRange | null;
  emissionOverDistance: ParticleVFXEditorValueRange | null;
  startRotation: ParticleVFXEditorValueRange | null;
  burstCount: ParticleVFXEditorValueRange | null;
  burst: ParticleVFXEditorBurstDraft | null;
  startLife: ParticleVFXEditorValueRange | null;
  startSpeed: ParticleVFXEditorValueRange | null;
  startSize: ParticleVFXEditorValueRange | null;
  startColor: ParticleVFXEditorColor | null;
  startColorGenerator: ParticleVFXEditorStartColorDraft;
  textureId: string | null;
  textureUrl: string | null;
  shape: ParticleVFXEditorShapeDraft;
  renderer: ParticleVFXEditorRendererDraft;
  hasSizeOverLife: boolean;
  hasColorOverLife: boolean;
  colorOverLife: ParticleVFXEditorColorOverLifeDraft;
  frameOverLife: ParticleVFXEditorFrameOverLifeDraft;
  advancedBehaviors: ParticleVFXEditorAdvancedBehaviorsDraft;
  forceOverLife: {
    x: ParticleVFXEditorValueRange | null;
    y: ParticleVFXEditorValueRange | null;
    z: ParticleVFXEditorValueRange | null;
  } | null;
};

export type ParticleVFXEditorCatalogDraft = {
  id: string;
  label: string;
  description: string;
  assetPath: string;
  defaultAnchor: ParticleVFXAnchor;
  defaultFollowAnchor: boolean;
  defaultDurationSec: number;
  defaultTransform: ParticleVFXTransform;
  preloadTier: ParticleVFXPreloadTier;
  performanceBudget: ParticleVFXPerformanceBudget;
  shapeAutoFit?: ParticleVFXShapeAutoFit;
};

export type ParticleVFXEditorDraft = {
  source: "catalog" | "imported" | "new";
  sourceEffectId: string | null;
  sourceAssetPath: string;
  catalog: ParticleVFXEditorCatalogDraft;
  quarksJson: JsonObject;
  emitters: ParticleVFXEmitterDraft[];
};

export type ParticleVFXEditorValidationIssue = {
  severity: "error" | "warning";
  code:
    | "invalid-json"
    | "missing-object"
    | "missing-emitter"
    | "invalid-texture-url"
    | "remote-texture-url"
    | "embedded-texture-url"
    | "missing-texture"
    | "blob-texture-url"
    | "unsupported-shape"
    | "unsupported-render-mode"
    | "unsupported-behavior-settings"
    | "trail-settings-missing"
    | "width-over-length-without-trail"
    | "rotation-3d-without-mesh"
    | "atlas-tiles-missing"
    | "atlas-metadata-mismatch"
    | "frame-over-life-without-atlas"
    | "frame-range-out-of-bounds"
    | "invalid-duration"
    | "duration-over-budget"
    | "looping-not-allowed"
    | "world-space-emitter"
    | "particle-budget-exceeded"
    | "asset-runtime-id"
    | "asset-manifest-limit"
    | "asset-resource-limit"
    | "asset-node-limit"
    | "asset-system-limit"
    | "asset-duration-limit"
    | "asset-looping-metadata"
    | "unresolved-texture"
    | "unsafe-texture-reference"
    | "ambiguous-texture-filename"
    | "unsupported-asset-structure"
    | "invalid-runtime-defaults";
  message: string;
  target: string;
};

export type ParticleVFXContentReadiness = {
  ready: boolean;
  issues: readonly ParticleVFXEditorValidationIssue[];
  uniqueTextureReferences: readonly string[];
  estimatedManifestBytes: number;
};

export type ParticleVFXEmitterPatch = Partial<{
  name: string;
  localPosition: Partial<ParticleVFXTransformAxisTriple>;
  durationSec: number;
  looping: boolean;
  worldSpace: boolean;
  emissionOverTime: ParticleVFXEditorValueRange;
  emissionOverDistance: ParticleVFXEditorValueRange;
  startRotation: ParticleVFXEditorValueRange;
  burst: Partial<ParticleVFXEditorBurstDraft>;
  burstCount: ParticleVFXEditorValueRange;
  startLife: ParticleVFXEditorValueRange;
  startSpeed: ParticleVFXEditorValueRange;
  startSize: ParticleVFXEditorValueRange;
  startColor: Partial<ParticleVFXEditorColor>;
  startColorGenerator: ParticleVFXEditorStartColorDraft;
  textureId: string;
  shape: Partial<ParticleVFXEditorShapeDraft> & {
    type?: ParticleVFXEditorShapeType;
  };
  renderer: Partial<ParticleVFXEditorRendererDraft>;
  emitterTemplateId: ParticleVFXEditorEmitterTemplateId;
  sizeOverLife: boolean;
  colorOverLife: boolean;
  colorOverLifeDraft: ParticleVFXEditorColorOverLifeDraft;
  frameOverLifeDraft: ParticleVFXEditorFrameOverLifeDraft;
  advancedBehaviors: Partial<ParticleVFXEditorAdvancedBehaviorsDraft>;
  forceOverLifeEnabled: boolean;
  forceOverLife: {
    x?: ParticleVFXEditorValueRange;
    y?: ParticleVFXEditorValueRange;
    z?: ParticleVFXEditorValueRange;
  };
}>;

export type ParticleVFXEditorExport = {
  assetFileName: string;
  assetPath: string;
  quarksJson: string;
  catalogEntrySnippet: string;
  clipEventSnippet: string;
};

export type ParticleVFXCreatorPreviewPlacement = {
  position: ParticleVFXTransformAxisTriple;
  rotation: ParticleVFXTransformAxisTriple;
  scale: ParticleVFXTransformAxisTriple;
  resolvedAnchor: ParticleVFXAnchor | null;
  boneName: string | null;
  warning: string | null;
  autoFit: {
    kind: "avatarBoundsRectangle";
    width: number;
    height: number;
  } | null;
};

export type ParticleVFXEditorExportJsonViewerPayload = {
  value: unknown | null;
  error: string | null;
};

export type EmitterNodeRef = {
  path: string;
  object: JsonObject;
};
