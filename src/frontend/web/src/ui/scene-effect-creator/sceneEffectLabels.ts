import type { TFunction } from "i18next";

import type {
  SceneBackgroundDirection,
  SceneBackgroundItemRotationMode,
  SceneBackgroundPatternKind,
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
 * The name of a catalog emoji, found by its character so stored marquee items
 * (which keep the English catalog label) show it too; `null` for an emoji the
 * catalog does not name.
 */
export function sceneEmojiName(
  t: TFunction<"effects">,
  emoji: string,
): string | null {
  switch (emoji) {
    case "✨":
      return t("scene.emoji.sparkles");
    case "💖":
      return t("scene.emoji.sparklingHeart");
    case "⭐":
      return t("scene.emoji.star");
    case "💥":
      return t("scene.emoji.collision");
    case "🌸":
      return t("scene.emoji.cherryBlossom");
    case "🎀":
      return t("scene.emoji.ribbon");
    case "🤩":
      return t("scene.emoji.starStruck");
    case "🤗":
      return t("scene.emoji.huggingFace");
    case "🏅":
      return t("scene.emoji.medal");
    case "👑":
      return t("scene.emoji.crown");
    case "🙏":
      return t("scene.emoji.foldedHands");
    case "😂":
      return t("scene.emoji.tearsOfJoy");
    case "🎉":
      return t("scene.emoji.partyPopper");
    case "🎯":
      return t("scene.emoji.target");
    case "🤔":
      return t("scene.emoji.thinkingFace");
    case "❓":
      return t("scene.emoji.questionMark");
    case "🌅":
      return t("scene.emoji.sunrise");
    case "⚠":
    case "⚠️":
      return t("scene.emoji.warning");
    case "💦":
      return t("scene.emoji.sweatDroplets");
    case "💫":
      return t("scene.emoji.dizzy");
    case "💢":
      return t("scene.emoji.angerSymbol");
    case "👎":
      return t("scene.emoji.thumbsDown");
    case "🤢":
      return t("scene.emoji.nauseatedFace");
    case "😳":
      return t("scene.emoji.flushedFace");
    case "🥺":
      return t("scene.emoji.pleadingFace");
    case "😞":
      return t("scene.emoji.disappointedFace");
    case "😢":
      return t("scene.emoji.cryingFace");
    case "🌧":
    case "🌧️":
      return t("scene.emoji.cloudWithRain");
    default:
      return null;
  }
}

/** A background layer the Setup panel lists and the Inspector edits. */
export type SceneBackgroundLayer = "marquee" | "pattern" | "solid";

export function sceneLayerName(
  t: TFunction<"effects">,
  layer: SceneBackgroundLayer,
): string {
  switch (layer) {
    case "marquee":
      return t("scene.layers.marquee");
    case "pattern":
      return t("scene.layers.pattern");
    case "solid":
      return t("scene.layers.solid");
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
