import {
  createConstantValueGeneratorDraft,
  createLinearValueGeneratorDraft,
  createRangeValueGeneratorDraft,
  createDefaultAdvancedBehaviorsDraft,
  setAdvancedBehaviorsDraft,
} from "./advancedBehaviors";
import { setBehaviorEnabled } from "./behaviors";
import { colorToGenerator, setColorOverLifeDraft } from "./colors";
import { FULL_CIRCLE_RADIANS } from "./constants";
import { setFirstBurst, setFirstBurstCount } from "./emitters";
import { patchRenderer } from "./renderer";
import { shapeToJson } from "./shapes";
import { setEmitterTexture } from "./textures";
import { valueRangeToGenerator } from "./numbers";
import type {
  JsonObject,
  ParticleVFXEditorAdvancedBehaviorsDraft,
  ParticleVFXEditorEmitterTemplateId,
} from "./types";

export const PARTICLE_VFX_EDITOR_EMITTER_TEMPLATES = [
  { id: "pop", label: "Pop" },
  { id: "aura", label: "Aura" },
  { id: "smoke-fade", label: "Smoke Fade" },
  { id: "speed-streak", label: "Speed Streak" },
  { id: "sparkle-burst", label: "Sparkle Burst" },
] as const satisfies readonly {
  id: ParticleVFXEditorEmitterTemplateId;
  label: string;
}[];

export function applyParticleVFXEmitterTemplate(
  quarksJson: JsonObject,
  ps: JsonObject,
  templateId: ParticleVFXEditorEmitterTemplateId,
): void {
  switch (templateId) {
    case "pop":
      applyPopTemplate(quarksJson, ps);
      return;
    case "aura":
      applyAuraTemplate(quarksJson, ps);
      return;
    case "smoke-fade":
      applySmokeFadeTemplate(quarksJson, ps);
      return;
    case "speed-streak":
      applySpeedStreakTemplate(quarksJson, ps);
      return;
    case "sparkle-burst":
      applySparkleBurstTemplate(quarksJson, ps);
      return;
  }
}

function applyPopTemplate(quarksJson: JsonObject, ps: JsonObject): void {
  setEmitterTexture(quarksJson, ps, "flare-star");
  applyBaseTemplate(ps, {
    duration: 0.45,
    emissionOverTime: 0,
    burstCount: 10,
    startLife: [0.35, 0.65],
    startSpeed: [0.18, 0.36],
    startSize: [0.12, 0.24],
    startRotation: [-2.8, 2.8],
    shape: "sphere",
    radius: 0.05,
    color: { r: 1, g: 0.82, b: 0.28, a: 1 },
  });
  patchRenderer(quarksJson, ps, {
    renderMode: 0,
    blending: "additive",
    opacity: 1,
    renderOrder: 24,
  });
  setColorOverLifeDraft(ps, {
    mode: "fade",
    stops: [
      { position: 0, color: { r: 1, g: 0.95, b: 0.52, a: 1 } },
      { position: 1, color: { r: 1, g: 0.42, b: 0.14, a: 0 } },
    ],
  });
  applyAdvancedPatch(ps, {
    speedOverLife: {
      mode: "enabled",
      value: createLinearValueGeneratorDraft(1, 0.15),
    },
    rotationOverLife: {
      mode: "enabled",
      value: createRangeValueGeneratorDraft(-2, 2),
    },
  });
}

function applyAuraTemplate(quarksJson: JsonObject, ps: JsonObject): void {
  setEmitterTexture(quarksJson, ps, "glow-soft");
  applyBaseTemplate(ps, {
    duration: 1.8,
    emissionOverTime: 18,
    burstCount: 4,
    startLife: [0.8, 1.25],
    startSpeed: [0.02, 0.08],
    startSize: [0.18, 0.36],
    startRotation: [-0.3, 0.3],
    shape: "sphere",
    radius: 0.22,
    color: { r: 0.42, g: 0.9, b: 1, a: 0.7 },
  });
  patchRenderer(quarksJson, ps, {
    renderMode: 0,
    blending: "additive",
    opacity: 0.75,
    renderOrder: 18,
  });
  setColorOverLifeDraft(ps, {
    mode: "fade",
    stops: [
      { position: 0, color: { r: 0.32, g: 0.92, b: 1, a: 0 } },
      { position: 0.25, color: { r: 0.52, g: 0.72, b: 1, a: 0.7 } },
      { position: 1, color: { r: 0.88, g: 0.58, b: 1, a: 0 } },
    ],
  });
  applyAdvancedPatch(ps, {
    orbitOverLife: {
      mode: "enabled",
      orbitSpeed: createRangeValueGeneratorDraft(-1.2, 1.2),
      axis: { x: 0, y: 1, z: 0 },
    },
    noise: {
      mode: "enabled",
      frequency: createConstantValueGeneratorDraft(1.8),
      power: createConstantValueGeneratorDraft(0.08),
      positionAmount: createConstantValueGeneratorDraft(1),
      rotationAmount: createConstantValueGeneratorDraft(0.15),
    },
  });
}

function applySmokeFadeTemplate(quarksJson: JsonObject, ps: JsonObject): void {
  setEmitterTexture(quarksJson, ps, "smoke-puff");
  applyBaseTemplate(ps, {
    duration: 1.4,
    emissionOverTime: 10,
    burstCount: 5,
    startLife: [1, 1.7],
    startSpeed: [0.03, 0.12],
    startSize: [0.16, 0.34],
    startRotation: [-1.2, 1.2],
    shape: "sphere",
    radius: 0.12,
    color: { r: 0.68, g: 0.72, b: 0.78, a: 0.55 },
  });
  patchRenderer(quarksJson, ps, {
    renderMode: 0,
    blending: "normal",
    opacity: 0.68,
    renderOrder: 12,
    depthWrite: false,
  });
  setColorOverLifeDraft(ps, {
    mode: "fade",
    stops: [
      { position: 0, color: { r: 0.62, g: 0.66, b: 0.72, a: 0 } },
      { position: 0.2, color: { r: 0.66, g: 0.68, b: 0.72, a: 0.55 } },
      { position: 1, color: { r: 0.82, g: 0.84, b: 0.88, a: 0 } },
    ],
  });
  applyAdvancedPatch(ps, {
    speedOverLife: {
      mode: "enabled",
      value: createLinearValueGeneratorDraft(0.8, 0.2),
    },
    noise: {
      mode: "enabled",
      frequency: createConstantValueGeneratorDraft(1.2),
      power: createConstantValueGeneratorDraft(0.12),
      positionAmount: createConstantValueGeneratorDraft(1),
      rotationAmount: createConstantValueGeneratorDraft(0.08),
    },
  });
}

function applySpeedStreakTemplate(
  quarksJson: JsonObject,
  ps: JsonObject,
): void {
  setEmitterTexture(quarksJson, ps, "speed-line");
  applyBaseTemplate(ps, {
    duration: 0.55,
    emissionOverTime: 0,
    burstCount: 14,
    startLife: [0.35, 0.65],
    startSpeed: [0.65, 1.15],
    startSize: [0.06, 0.11],
    startRotation: [-0.2, 0.2],
    shape: "cone",
    radius: 0.18,
    color: { r: 0.75, g: 0.95, b: 1, a: 0.9 },
  });
  patchRenderer(quarksJson, ps, {
    renderMode: 1,
    blending: "additive",
    opacity: 0.9,
    renderOrder: 28,
    speedFactor: 0.04,
    lengthFactor: 2.2,
  });
  setColorOverLifeDraft(ps, {
    mode: "fade",
    stops: [
      { position: 0, color: { r: 0.72, g: 0.95, b: 1, a: 0.9 } },
      { position: 1, color: { r: 0.38, g: 0.62, b: 1, a: 0 } },
    ],
  });
  applyAdvancedPatch(ps, {
    speedOverLife: {
      mode: "enabled",
      value: createLinearValueGeneratorDraft(1, 0.35),
    },
    limitSpeedOverLife: {
      mode: "enabled",
      speed: createConstantValueGeneratorDraft(0.9),
      dampen: 0.5,
    },
  });
}

function applySparkleBurstTemplate(
  quarksJson: JsonObject,
  ps: JsonObject,
): void {
  setEmitterTexture(quarksJson, ps, "spark-pop-6x5");
  applyBaseTemplate(ps, {
    duration: 0.85,
    emissionOverTime: 0,
    burstCount: 18,
    startLife: [0.55, 0.95],
    startSpeed: [0.16, 0.42],
    startSize: [0.08, 0.17],
    startRotation: [-3, 3],
    shape: "sphere",
    radius: 0.1,
    color: { r: 0.9, g: 0.74, b: 1, a: 1 },
  });
  patchRenderer(quarksJson, ps, {
    renderMode: 0,
    blending: "additive",
    opacity: 1,
    renderOrder: 26,
  });
  setColorOverLifeDraft(ps, {
    mode: "random-gradient",
    gradientA: [
      { position: 0, color: { r: 0.25, g: 0.9, b: 1, a: 1 } },
      { position: 1, color: { r: 0.95, g: 1, b: 1, a: 0 } },
    ],
    gradientB: [
      { position: 0, color: { r: 0.86, g: 0.46, b: 1, a: 1 } },
      { position: 1, color: { r: 1, g: 0.92, b: 0.45, a: 0 } },
    ],
  });
  applyAdvancedPatch(ps, {
    orbitOverLife: {
      mode: "enabled",
      orbitSpeed: createRangeValueGeneratorDraft(-2.4, 2.4),
      axis: { x: 0, y: 1, z: 0 },
    },
    noise: {
      mode: "enabled",
      frequency: createConstantValueGeneratorDraft(2.2),
      power: createConstantValueGeneratorDraft(0.06),
      positionAmount: createConstantValueGeneratorDraft(1),
      rotationAmount: createConstantValueGeneratorDraft(0.22),
    },
    rotationOverLife: {
      mode: "enabled",
      value: createRangeValueGeneratorDraft(-4, 4),
    },
  });
}

function applyBaseTemplate(
  ps: JsonObject,
  options: {
    duration: number;
    emissionOverTime: number;
    burstCount: number;
    startLife: [number, number];
    startSpeed: [number, number];
    startSize: [number, number];
    startRotation: [number, number];
    shape: "sphere" | "cone";
    radius: number;
    color: { r: number; g: number; b: number; a: number };
  },
): void {
  ps.duration = options.duration;
  ps.looping = false;
  ps.emissionOverTime = valueRangeToGenerator({
    min: options.emissionOverTime,
    max: options.emissionOverTime,
  });
  ps.emissionOverDistance = valueRangeToGenerator({ min: 0, max: 0 });
  ps.startLife = valueRangeToGenerator({
    min: options.startLife[0],
    max: options.startLife[1],
  });
  ps.startSpeed = valueRangeToGenerator({
    min: options.startSpeed[0],
    max: options.startSpeed[1],
  });
  ps.startSize = valueRangeToGenerator({
    min: options.startSize[0],
    max: options.startSize[1],
  });
  ps.startRotation = valueRangeToGenerator({
    min: options.startRotation[0],
    max: options.startRotation[1],
  });
  ps.startColor = colorToGenerator(options.color);
  ps.shape = shapeToJson({
    type: options.shape,
    radius: options.radius,
    width: 1,
    height: 1,
    arc: FULL_CIRCLE_RADIANS,
    thickness: 1,
    angle: options.shape === "cone" ? 0.35 : 0,
    mode: 0,
    spread: 0,
    speed: { min: 1, max: 1 },
  });
  setFirstBurst(ps, {
    time: 0,
    count: { min: options.burstCount, max: options.burstCount },
    interval: 0.01,
    cycle: 1,
    probability: 1,
  });
  setFirstBurstCount(ps, { min: options.burstCount, max: options.burstCount });
  setBehaviorEnabled(ps, "ForceOverLife", false);
  setBehaviorEnabled(ps, "SizeOverLife", true);
}

function applyAdvancedPatch(
  ps: JsonObject,
  patch: Partial<ParticleVFXEditorAdvancedBehaviorsDraft>,
): void {
  const defaults = createDefaultAdvancedBehaviorsDraft();
  setAdvancedBehaviorsDraft(ps, {
    ...defaults,
    ...patch,
  });
}
