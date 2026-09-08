import type {
  ParticleVFXAnchor,
  ParticleVFXCatalogEntry,
  ParticleVFXPerformanceBudget,
  ParticleVFXPreloadTier,
  ParticleVFXShapeAutoFit,
  ParticleVFXTransform,
  ParticleVFXTransformInput,
} from "./types";

export function createDefaultParticleVFXTransform(): ParticleVFXTransform {
  return {
    offset: { x: 0, y: 0, z: 0 },
    depthOffset: 0,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

const cartoonBangTransform = createDefaultParticleVFXTransform();
cartoonBangTransform.offset.y = 0.22;
cartoonBangTransform.scale = { x: 0.16, y: 0.16, z: 0.16 };

function transform(override: ParticleVFXTransformInput): ParticleVFXTransform {
  const next = createDefaultParticleVFXTransform();
  next.offset = { ...next.offset, ...override.offset };
  next.depthOffset = override.depthOffset ?? next.depthOffset;
  next.rotation = { ...next.rotation, ...override.rotation };
  next.scale = { ...next.scale, ...override.scale };
  return next;
}

function budget(
  maxDurationSec: number,
  maxParticles: number,
  options: Partial<Pick<ParticleVFXPerformanceBudget, "canCoexist">> = {},
): ParticleVFXPerformanceBudget {
  return {
    maxDurationSec,
    maxParticles,
    loopingAllowed: false,
    canCoexist: options.canCoexist ?? true,
  };
}

function entry(args: {
  id: string;
  label: string;
  description: string;
  assetPath: string;
  defaultAnchor: ParticleVFXAnchor;
  defaultDurationSec: number;
  defaultTransform: ParticleVFXTransform;
  preloadTier?: ParticleVFXPreloadTier;
  performanceBudget: ParticleVFXPerformanceBudget;
  shapeAutoFit?: ParticleVFXShapeAutoFit;
}): ParticleVFXCatalogEntry {
  return {
    preloadTier: "tierA",
    defaultFollowAnchor: true,
    ...args,
  };
}

export const AVATAR_PARTICLE_VFX_CATALOG = [
  entry({
    id: "cartoon-bang",
    label: "Cartoon Bang",
    description: "A one-shot comic burst for validating quarks particles.",
    assetPath: "/effects/vfx/quark/cartoon-bang/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2,
    defaultTransform: cartoonBangTransform,
    preloadTier: "none",
    performanceBudget: {
      ...budget(2.5, 96, { canCoexist: false }),
      loopingAllowed: false,
    },
  }),
  entry({
    id: "hearts",
    label: "Hearts",
    description: "Soft hearts that float upward for affection or admiration.",
    assetPath: "/effects/vfx/quark/hearts/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.8,
    defaultTransform: transform({
      offset: { y: 0.32 },
      depthOffset: 0.12,
      scale: { x: 1, y: 1, z: 1 },
    }),
    performanceBudget: budget(2.2, 8),
  }),
  entry({
    id: "stars",
    label: "Stars",
    description: "A quick yellow star burst for delight or success.",
    assetPath: "/effects/vfx/quark/stars/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.4,
    defaultTransform: transform({
      offset: { y: 0.26 },
      depthOffset: 0.1,
    }),
    performanceBudget: budget(1.8, 10),
  }),
  entry({
    id: "sparkles",
    label: "Sparkles",
    description: "Small cyan-white sparkle pings for positive emphasis.",
    assetPath: "/effects/vfx/quark/sparkles/particle.json",
    defaultAnchor: "chest",
    defaultDurationSec: 1.6,
    defaultTransform: transform({
      offset: { y: 0.18 },
      depthOffset: 0.14,
    }),
    performanceBudget: budget(2, 15),
  }),
  entry({
    id: "question-marks",
    label: "Question Marks",
    description: "Floating question marks for confusion or curiosity.",
    assetPath: "/effects/vfx/quark/question-marks/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2,
    defaultTransform: transform({
      offset: { x: 0.08, y: 0.34 },
      depthOffset: 0.12,
    }),
    performanceBudget: budget(2.4, 6),
  }),
  entry({
    id: "exclamation",
    label: "Exclamation",
    description: "A sharp exclamation pop for surprise or realization.",
    assetPath: "/effects/vfx/quark/exclamation/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.2,
    defaultTransform: transform({
      offset: { y: 0.36 },
      depthOffset: 0.14,
    }),
    performanceBudget: budget(1.6, 5),
  }),
  entry({
    id: "zzz",
    label: "Zzz",
    description: "Sleepy drifting Zs for tired or bored moments.",
    assetPath: "/effects/vfx/quark/zzz/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2.5,
    defaultTransform: transform({
      offset: { x: 0.08, y: 0.32 },
      depthOffset: 0.1,
    }),
    performanceBudget: budget(2.8, 5),
  }),
  entry({
    id: "rain-cloud",
    label: "Rain Cloud",
    description: "A small cloud and light rain for sadness or disappointment.",
    assetPath: "/effects/vfx/quark/rain-cloud/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2.4,
    defaultTransform: transform({
      offset: { y: 0.42 },
      depthOffset: 0.08,
    }),
    performanceBudget: budget(2.8, 16, { canCoexist: false }),
  }),
  entry({
    id: "hearts-v1",
    label: "hearts-v1",
    description: "hearts",
    assetPath: "/effects/vfx/quark/hearts-v1/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 15,
    defaultTransform: transform({
      offset: { x: 0, y: 0.1, z: -0.15 },
      depthOffset: 0,
      rotation: { x: 1, y: 0.1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    preloadTier: "tierA",
    performanceBudget: {
      maxDurationSec: 30,
      maxParticles: 64,
      loopingAllowed: true,
      canCoexist: true,
    },
  }),
  entry({
    id: "exclamation-v1",
    label: "Exclamation-v1",
    description: "Exclamation",
    assetPath: "/effects/vfx/quark/exclamation-v1/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 15,
    defaultTransform: transform({
      offset: { x: 0, y: 0, z: 0 },
      depthOffset: 0,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    preloadTier: "none",
    performanceBudget: {
      maxDurationSec: 30,
      maxParticles: 64,
      loopingAllowed: true,
      canCoexist: true,
    },
  }),
  entry({
    id: "question-v1",
    label: "Question-v1",
    description: "Question-v1",
    assetPath: "/effects/vfx/quark/question-v1/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 15,
    defaultTransform: transform({
      offset: { x: 0, y: 0, z: 0 },
      depthOffset: 0,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    preloadTier: "none",
    performanceBudget: {
      maxDurationSec: 30,
      maxParticles: 64,
      loopingAllowed: true,
      canCoexist: true,
    },
  }),
  entry({
    id: "hearts-v2",
    label: "hearts-v2",
    description: "hearts-v2",
    assetPath: "/effects/vfx/quark/hearts-v2/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.2,
    defaultTransform: transform({
      offset: { x: 0, y: 0, z: 0 },
      depthOffset: 0,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    preloadTier: "none",
    performanceBudget: {
      maxDurationSec: 15,
      maxParticles: 64,
      loopingAllowed: true,
      canCoexist: true,
    },
  }),
  entry({
    id: "star-v2",
    label: "star-v2",
    description: "star-v2",
    assetPath: "/effects/vfx/quark/star-v2/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.2,
    defaultTransform: transform({
      offset: { x: 0, y: 0, z: 0 },
      depthOffset: 0,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    preloadTier: "none",
    performanceBudget: {
      maxDurationSec: 15,
      maxParticles: 64,
      loopingAllowed: true,
      canCoexist: true,
    },
  }),
  entry({
    id: "flame-loop",
    label: "Flame Loop",
    description:
      "A layered chest-centered flame aura for persistent manual debug playback.",
    assetPath: "/effects/vfx/quark/flame-loop/particle.json",
    defaultAnchor: "chest",
    defaultDurationSec: 8,
    defaultTransform: transform({
      offset: { y: 0.06 },
      depthOffset: 0.08,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.88, y: 0.88, z: 0.88 },
    }),
    preloadTier: "none",
    performanceBudget: {
      maxDurationSec: 30,
      maxParticles: 64,
      loopingAllowed: true,
      canCoexist: false,
    },
  }),
  entry({
    id: "magic-sparkle-burst",
    label: "Magic Sparkle Burst",
    description:
      "A layered magical pop with a flipbook burst, ring, flares, and streaking sparks.",
    assetPath: "/effects/vfx/quark/magic-sparkle-burst/particle.json",
    defaultAnchor: "chest",
    defaultDurationSec: 1.8,
    defaultTransform: transform({
      offset: { y: 0.22 },
      depthOffset: 0.14,
      scale: { x: 1, y: 1, z: 1 },
    }),
    preloadTier: "none",
    performanceBudget: budget(2.4, 52),
  }),
  entry({
    id: "soft-heart-pop",
    label: "Soft Heart Pop",
    description:
      "A warm affection pop with hearts, a gentle glow, and small sparkle dots.",
    assetPath: "/effects/vfx/quark/soft-heart-pop/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.9,
    defaultTransform: transform({
      offset: { y: 0.34 },
      depthOffset: 0.12,
      scale: { x: 0.95, y: 0.95, z: 0.95 },
    }),
    preloadTier: "none",
    performanceBudget: budget(2.4, 36),
  }),
  entry({
    id: "surprise-shock-pop",
    label: "Surprise Shock Pop",
    description:
      "A sharp surprise accent with a shock ring, exclamation mark, and radial streaks.",
    assetPath: "/effects/vfx/quark/surprise-shock-pop/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 1.25,
    defaultTransform: transform({
      offset: { y: 0.34 },
      depthOffset: 0.16,
      scale: { x: 1.05, y: 1.05, z: 1.05 },
    }),
    preloadTier: "none",
    performanceBudget: budget(1.8, 40, { canCoexist: false }),
  }),
  entry({
    id: "confusion-orbit-marks",
    label: "Confusion Orbit Marks",
    description:
      "Orbiting question marks and dots for confused or curious reactions.",
    assetPath: "/effects/vfx/quark/confusion-orbit-marks/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2.3,
    defaultTransform: transform({
      offset: { x: 0.08, y: 0.35 },
      depthOffset: 0.13,
    }),
    preloadTier: "none",
    performanceBudget: budget(2.8, 32, { canCoexist: false }),
  }),
  entry({
    id: "sleep-bubbles",
    label: "Sleep Bubbles",
    description: "Soft drifting sleep bubbles with sleepy Zs and tiny glints.",
    assetPath: "/effects/vfx/quark/sleep-bubbles/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2.8,
    defaultTransform: transform({
      offset: { x: 0.1, y: 0.32 },
      depthOffset: 0.12,
      scale: { x: 0.95, y: 0.95, z: 0.95 },
    }),
    preloadTier: "none",
    performanceBudget: budget(3.2, 28, { canCoexist: false }),
  }),
  entry({
    id: "sad-rain-puff",
    label: "Sad Rain Puff",
    description:
      "A small rain cloud with falling drops and muted smoke puffs for sad moments.",
    assetPath: "/effects/vfx/quark/sad-rain-puff/particle.json",
    defaultAnchor: "head",
    defaultDurationSec: 2.5,
    defaultTransform: transform({
      offset: { y: 0.42 },
      depthOffset: 0.08,
    }),
    preloadTier: "none",
    performanceBudget: budget(3, 42, { canCoexist: false }),
  }),
] as const satisfies readonly ParticleVFXCatalogEntry[];
