import type { TFunction } from "i18next";

import type {
  SceneBackgroundDirection,
  SceneBackgroundGradientType,
  SceneBackgroundItemRotationMode,
  SceneBackgroundPatternKind,
  SceneBackgroundScatterPulse,
  SceneBackgroundScreenKind,
} from "@/lib/scene-vfx/types";

/*
 * Display names for the Scene Effect creator's stored values. The values stay
 * as authored data; only their names are worded in the UI Locale.
 */

export function sceneDirectionName(
  t: TFunction<"effects">,
  direction: SceneBackgroundDirection,
): string {
  switch (direction) {
    case "static":
      return t("scene.directions.static");
    case "left":
      return t("scene.directions.left");
    case "right":
      return t("scene.directions.right");
    case "up":
      return t("scene.directions.up");
    case "down":
      return t("scene.directions.down");
    case "diagonal-up-left":
      return t("scene.directions.upLeft");
    case "diagonal-down-left":
      return t("scene.directions.downLeft");
    case "diagonal-up-right":
      return t("scene.directions.upRight");
    case "diagonal-down-right":
      return t("scene.directions.downRight");
  }
}

export function sceneRotationModeName(
  t: TFunction<"effects">,
  mode: SceneBackgroundItemRotationMode,
): string {
  switch (mode) {
    case "upright":
      return t("scene.rotationModes.upright");
    case "follow-track":
      return t("scene.rotationModes.followTrack");
  }
}

export function scenePatternName(
  t: TFunction<"effects">,
  pattern: SceneBackgroundPatternKind,
): string {
  switch (pattern) {
    case "none":
      return t("scene.patterns.none");
    case "polkadot":
      return t("scene.patterns.polkadot");
    case "heart":
      return t("scene.patterns.heart");
    case "star":
      return t("scene.patterns.star");
  }
}

/**
 * A background layer the Setup panel lists and the Inspector edits; scatter
 * layers are named by number instead (`scene.layers.scatter`).
 */
export type SceneBackgroundLayer =
  | "solid"
  | "gradient"
  | "pattern"
  | "tile"
  | "screen"
  | "marquee"
  | "flash";

export function sceneLayerName(
  t: TFunction<"effects">,
  layer: SceneBackgroundLayer,
): string {
  switch (layer) {
    case "solid":
      return t("scene.layers.solid");
    case "gradient":
      return t("scene.layers.gradient");
    case "pattern":
      return t("scene.layers.pattern");
    case "tile":
      return t("scene.layers.tile");
    case "screen":
      return t("scene.layers.screen");
    case "marquee":
      return t("scene.layers.marquee");
    case "flash":
      return t("scene.layers.flash");
  }
}

export function sceneScreenKindName(
  t: TFunction<"effects">,
  kind: SceneBackgroundScreenKind,
): string {
  switch (kind) {
    case "rays":
      return t("scene.screenKinds.rays");
    case "lines":
      return t("scene.screenKinds.lines");
  }
}

export function sceneGradientTypeName(
  t: TFunction<"effects">,
  type: SceneBackgroundGradientType,
): string {
  switch (type) {
    case "linear":
      return t("scene.gradientTypes.linear");
    case "radial":
      return t("scene.gradientTypes.radial");
  }
}

export function scenePulseName(
  t: TFunction<"effects">,
  pulse: SceneBackgroundScatterPulse,
): string {
  switch (pulse) {
    case "none":
      return t("scene.pulses.none");
    case "twinkle":
      return t("scene.pulses.twinkle");
    case "pop":
      return t("scene.pulses.pop");
    case "flicker":
      return t("scene.pulses.flicker");
  }
}

/** The preview Avatar's load state, for the Checks list. */
export function previewStateName(
  t: TFunction<"effects">,
  state: "idle" | "loading" | "ready" | "error",
): string {
  switch (state) {
    case "idle":
      return t("scene.checks.states.idle");
    case "loading":
      return t("scene.checks.states.loading");
    case "ready":
      return t("scene.checks.states.ready");
    case "error":
      return t("scene.checks.states.error");
  }
}

/** A manual focus box edge or size, in normalized viewport units. */
export function manualBoxFieldName(
  t: TFunction<"effects">,
  field: "x" | "y" | "width" | "height",
): string {
  switch (field) {
    case "x":
      return t("scene.focus.box.x");
    case "y":
      return t("scene.focus.box.y");
    case "width":
      return t("scene.focus.box.width");
    case "height":
      return t("scene.focus.box.height");
  }
}
