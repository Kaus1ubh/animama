import type { TFunction } from "i18next";

import type {
  ParticleVFXAnchor,
  ParticleVFXEditorBlending,
  ParticleVFXEditorColorOverLifeDraft,
  ParticleVFXEditorEmitterMode,
  ParticleVFXEditorEmitterTemplateId,
  ParticleVFXEditorRenderMode,
  ParticleVFXEditorRotation3DOverLifeDraft,
  ParticleVFXEditorShapeType,
  ParticleVFXEditorStartColorDraft,
  ParticleVFXEditorTextureRole,
  ParticleVFXPreloadTier,
} from "@/lib/avatar/particle-vfx";
import type { ContentCreatorModelSource } from "@/ui/content-creator/contentCreatorModelPreview";

/*
 * Display labels for the stable IDs the Particle Effect creator stores in its
 * documents (anchors, shapes, modes, presets and curated textures). The IDs
 * stay as stored; only their display is translated. Each helper takes the
 * `particles` translator so the extractor sees its literal keys.
 */

export function particleVFXAnchorLabel(
  t: TFunction<"particles">,
  anchor: ParticleVFXAnchor | "inherit",
): string {
  switch (anchor) {
    case "inherit":
      return t("anchors.inherit");
    case "root":
      return t("anchors.root");
    case "hips":
      return t("anchors.hips");
    case "spine":
      return t("anchors.spine");
    case "chest":
      return t("anchors.chest");
    case "neck":
      return t("anchors.neck");
    case "head":
      return t("anchors.head");
    case "leftHand":
      return t("anchors.leftHand");
    case "rightHand":
      return t("anchors.rightHand");
    case "leftFoot":
      return t("anchors.leftFoot");
    case "rightFoot":
      return t("anchors.rightFoot");
  }
}

export function particleVFXPreloadTierLabel(
  t: TFunction<"particles">,
  tier: ParticleVFXPreloadTier,
): string {
  switch (tier) {
    case "tierA":
      return t("settings.preloadTiers.tierA");
    case "tierB":
      return t("settings.preloadTiers.tierB");
    case "none":
      return t("settings.preloadTiers.none");
  }
}

export function particleVFXShapeLabel(
  t: TFunction<"particles">,
  shape: ParticleVFXEditorShapeType | "unsupported",
): string {
  switch (shape) {
    case "point":
      return t("shape.types.point");
    case "sphere":
      return t("shape.types.sphere");
    case "cone":
      return t("shape.types.cone");
    case "rectangle":
      return t("shape.types.rectangle");
    case "unsupported":
      return t("shape.types.unsupported");
  }
}

export function particleVFXEmitterModeLabel(
  t: TFunction<"particles">,
  mode: ParticleVFXEditorEmitterMode,
): string {
  switch (mode) {
    case 0:
      return t("shape.modes.random");
    case 1:
      return t("shape.modes.loop");
    case 2:
      return t("shape.modes.pingPong");
    case 3:
      return t("shape.modes.burst");
  }
}

export function particleVFXBlendingLabel(
  t: TFunction<"particles">,
  blending: ParticleVFXEditorBlending,
): string {
  switch (blending) {
    case "additive":
      return t("renderer.blendings.additive");
    case "normal":
      return t("renderer.blendings.normal");
  }
}

export function particleVFXRenderModeLabel(
  t: TFunction<"particles">,
  mode: ParticleVFXEditorRenderMode,
): string {
  switch (mode) {
    case 0:
      return t("renderer.modes.billboard");
    case 1:
      return t("renderer.modes.stretched");
    case 2:
      return t("renderer.modes.mesh");
    case 3:
      return t("renderer.modes.trail");
    case 4:
      return t("renderer.modes.horizontal");
    case 5:
      return t("renderer.modes.vertical");
  }
}

export function particleVFXTextureRoleLabel(
  t: TFunction<"particles">,
  role: ParticleVFXEditorTextureRole,
): string {
  switch (role) {
    case "glow":
      return t("texture.roles.glow");
    case "spark":
      return t("texture.roles.spark");
    case "smoke":
      return t("texture.roles.smoke");
    case "trail":
      return t("texture.roles.trail");
    case "symbol":
      return t("texture.roles.symbol");
  }
}

/** A curated texture's name; an unknown ID keeps its authored label. */
export function particleVFXTextureLabel(
  t: TFunction<"particles">,
  texture: { id: string; label: string },
): string {
  switch (texture.id) {
    case "soft-dot":
      return t("texture.names.softDot");
    case "glow-soft":
      return t("texture.names.glowSoft");
    case "glow-sharp":
      return t("texture.names.glowSharp");
    case "flare-star":
      return t("texture.names.flareStar");
    case "brackeys-flare":
      return t("texture.names.brackeysFlare");
    case "fire-8x8":
      return t("texture.names.fire8x8");
    case "flame-16x4":
      return t("texture.names.flame16x4");
    case "kenney-fire-glow":
      return t("texture.names.kenneyFireGlow");
    case "kenney-flame-core":
      return t("texture.names.kenneyFlameCore");
    case "kenney-flame-tongue":
      return t("texture.names.kenneyFlameTongue");
    case "sparkle":
      return t("texture.names.sparkle");
    case "spark-cross":
      return t("texture.names.sparkCross");
    case "spark-dot":
      return t("texture.names.sparkDot");
    case "spark-streak":
      return t("texture.names.sparkStreak");
    case "brackeys-spark":
      return t("texture.names.brackeysSpark");
    case "spark-pop-6x5":
      return t("texture.names.sparkPop6x5");
    case "kenney-ember-spark":
      return t("texture.names.kenneyEmberSpark");
    case "smoke-puff":
      return t("texture.names.smokePuff");
    case "smoke-wisp":
      return t("texture.names.smokeWisp");
    case "dust-soft":
      return t("texture.names.dustSoft");
    case "brackeys-smoke":
      return t("texture.names.brackeysSmoke");
    case "smoke-8x8":
      return t("texture.names.smoke8x8");
    case "kenney-smoke-wisp":
      return t("texture.names.kenneySmokeWisp");
    case "trail-taper":
      return t("texture.names.trailTaper");
    case "slash-arc":
      return t("texture.names.slashArc");
    case "speed-line":
      return t("texture.names.speedLine");
    case "heart":
      return t("texture.names.heart");
    case "star":
      return t("texture.names.star");
    case "cloud":
      return t("texture.names.cloud");
    case "raindrop":
      return t("texture.names.raindrop");
    case "question":
      return t("texture.names.question");
    case "exclamation":
      return t("texture.names.exclamation");
    case "zzz":
      return t("texture.names.zzz");
    case "star-v2":
      return t("texture.names.starV2");
    case "heart-v2":
      return t("texture.names.heartV2");
    case "magic-ring":
      return t("texture.names.magicRing");
    case "rune-circle":
      return t("texture.names.runeCircle");
    case "shock-ring":
      return t("texture.names.shockRing");
    default:
      return texture.label;
  }
}

export function particleVFXEmitterTemplateLabel(
  t: TFunction<"particles">,
  template: ParticleVFXEditorEmitterTemplateId,
): string {
  switch (template) {
    case "pop":
      return t("inspector.presets.pop");
    case "aura":
      return t("inspector.presets.aura");
    case "smoke-fade":
      return t("inspector.presets.smokeFade");
    case "speed-streak":
      return t("inspector.presets.speedStreak");
    case "sparkle-burst":
      return t("inspector.presets.sparkleBurst");
  }
}

/** A color theme preset's name; an unknown ID shows as stored. */
export function particleVFXColorThemeLabel(
  t: TFunction<"particles">,
  presetId: string,
): string {
  switch (presetId) {
    case "affection":
      return t("color.themes.affection.label");
    case "magic-sparkle":
      return t("color.themes.magicSparkle.label");
    case "surprise":
      return t("color.themes.surprise.label");
    case "sadness":
      return t("color.themes.sadness.label");
    case "sleep":
      return t("color.themes.sleep.label");
    case "neutral-soft":
      return t("color.themes.neutralSoft.label");
    default:
      return presetId;
  }
}

/** A color theme preset's description, or `null` for an unknown ID. */
export function particleVFXColorThemeDescription(
  t: TFunction<"particles">,
  presetId: string,
): string | null {
  switch (presetId) {
    case "affection":
      return t("color.themes.affection.description");
    case "magic-sparkle":
      return t("color.themes.magicSparkle.description");
    case "surprise":
      return t("color.themes.surprise.description");
    case "sadness":
      return t("color.themes.sadness.description");
    case "sleep":
      return t("color.themes.sleep.description");
    case "neutral-soft":
      return t("color.themes.neutralSoft.description");
    default:
      return null;
  }
}

export function particleVFXStartColorModeLabel(
  t: TFunction<"particles">,
  mode: Exclude<ParticleVFXEditorStartColorDraft["mode"], "unsupported">,
): string {
  switch (mode) {
    case "fixed":
      return t("color.start.modes.fixed");
    case "range":
      return t("color.start.modes.range");
    case "theme":
      return t("color.start.modes.theme");
  }
}

export function particleVFXColorOverLifeModeLabel(
  t: TFunction<"particles">,
  mode: Exclude<ParticleVFXEditorColorOverLifeDraft["mode"], "unsupported">,
): string {
  switch (mode) {
    case "off":
      return t("color.overLife.modes.off");
    case "fade":
      return t("color.overLife.modes.fade");
    case "gradient":
      return t("color.overLife.modes.gradient");
    case "random-gradient":
      return t("color.overLife.modes.randomGradient");
  }
}

export function particleVFXRotation3DModeLabel(
  t: TFunction<"particles">,
  mode: Exclude<
    ParticleVFXEditorRotation3DOverLifeDraft["mode"],
    "unsupported"
  >,
): string {
  switch (mode) {
    case "off":
      return t("behavior.rotation3D.modes.off");
    case "axis-angle":
      return t("behavior.rotation3D.modes.axisAngle");
    case "euler":
      return t("behavior.rotation3D.modes.euler");
    case "random":
      return t("behavior.rotation3D.modes.random");
  }
}

/** Where the preview model comes from, beside its name. */
export function particleVFXModelSourceLabel(
  t: TFunction<"particles">,
  source: ContentCreatorModelSource["sourceLabel"],
): string {
  switch (source) {
    case "Preview Anima":
      return t("preview.modelSources.previewAnima");
    case "Built-in Avatar":
      return t("preview.modelSources.builtInAvatar");
    case "My Avatar":
      return t("preview.modelSources.myAvatar");
  }
}
