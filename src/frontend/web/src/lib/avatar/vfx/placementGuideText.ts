import { getI18n } from "react-i18next";

import { apiErrorLine, uncodedErrorText } from "@/lib/errors/apiError";
import type { AvatarFaceTextureFlattenRegion } from "./texture-anchor-types";
import type { AvatarVFXSide } from "./types";

/*
 * Wording for the creator's placement guides: the names drawn beside each
 * reference point and texture area, and the short explanations under them.
 * Placement instances carry raw labels (`left`, `top-edge-left`, `mouth`);
 * they are worded here, in the UI Locale, only for display.
 */

/** A raw label with no catalog name, shown capitalized as before. */
function rawGuideLabel(label: string): string {
  const name = label.replaceAll("-", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** An eye hover reference: one eye or the point between them. */
export function eyeGuideLabel(label: string): string {
  const t = getI18n().getFixedT(null, "effects");
  switch (label) {
    case "left":
      return t("guides.labels.eyeLeft");
    case "right":
      return t("guides.labels.eyeRight");
    case "center":
      return t("guides.labels.eyeCenter");
    default:
      return rawGuideLabel(label);
  }
}

export function mouthGuideLabel(): string {
  const t = getI18n().getFixedT(null, "effects");
  return t("guides.labels.mouth");
}

/** A painted under-eye or cheek decal: one side, or one image across both. */
export function anchoredGuideLabel(
  anchor: "undereye" | "blush",
  label: string,
): string {
  const t = getI18n().getFixedT(null, "effects");
  if (anchor === "undereye")
    switch (label) {
      case "left":
        return t("guides.labels.undereyeLeft");
      case "right":
        return t("guides.labels.undereyeRight");
      case "span":
        return t("guides.labels.undereyeSpan");
    }
  else
    switch (label) {
      case "left":
        return t("guides.labels.blushLeft");
      case "right":
        return t("guides.labels.blushRight");
      case "span":
        return t("guides.labels.blushSpan");
    }
  return rawGuideLabel(label);
}

/** Art painted on the irises (`left`, `right` or `both`) or the whole face. */
export function textureGuideLabel(iris: boolean, label: string): string {
  const t = getI18n().getFixedT(null, "effects");
  if (!iris) return t("guides.labels.face");
  switch (label) {
    case "left":
      return t("guides.labels.irisLeft");
    case "right":
      return t("guides.labels.irisRight");
    case "both":
      return t("guides.labels.irisBoth");
    default:
      return rawGuideLabel(label);
  }
}

/** A floating placement on the head (`forehead-left`, `top-edge-right-corner`). */
export function boxGuideLabel(placement: string): string {
  const t = getI18n().getFixedT(null, "effects");
  switch (placement) {
    case "forehead-left":
      return t("guides.labels.foreheadLeft");
    case "forehead-middle":
      return t("guides.labels.foreheadMiddle");
    case "forehead-right":
      return t("guides.labels.foreheadRight");
    case "top-left":
      return t("guides.labels.topLeft");
    case "top-middle":
      return t("guides.labels.topMiddle");
    case "top-right":
      return t("guides.labels.topRight");
    case "top-edge-left-corner":
      return t("guides.labels.topEdgeLeftCorner");
    case "top-edge-left":
      return t("guides.labels.topEdgeLeft");
    case "top-edge-middle":
      return t("guides.labels.topEdgeMiddle");
    case "top-edge-right":
      return t("guides.labels.topEdgeRight");
    case "top-edge-right-corner":
      return t("guides.labels.topEdgeRightCorner");
    default:
      return rawGuideLabel(placement);
  }
}

/** Face-flatten coverage (skin painted over eyes or mouth) and its skin sample. */
export function flattenGuideLabel(
  region: AvatarFaceTextureFlattenRegion,
  side: AvatarVFXSide | null,
): string {
  const t = getI18n().getFixedT(null, "effects");
  switch (region) {
    case "sample":
      return t("guides.labels.skinSample");
    case "mouth":
      return t("guides.labels.flattenMouth");
    case "eye":
      return side === "left"
        ? t("guides.labels.flattenEyeLeft")
        : side === "right"
          ? t("guides.labels.flattenEyeRight")
          : t("guides.labels.flattenEye");
  }
}

/** A material with no name in the model. */
export function unnamedMaterialName(): string {
  const t = getI18n().getFixedT(null, "effects");
  return t("guides.selectedMaterial");
}

/** Explanations shown under the guides when data is missing or estimated. */
export type PlacementGuideMessage =
  | "noMaterialTarget"
  | "landmarksUnavailable"
  | "hoverAnchorUnavailable"
  | "textureAnchorsUnavailable"
  | "estimatedAnchor"
  | "liveAnchorUnavailable"
  | "estimatedFlatten"
  | "noTextureSurface";

export function placementGuideMessage(message: PlacementGuideMessage): string {
  const t = getI18n().getFixedT(null, "effects");
  switch (message) {
    case "noMaterialTarget":
      return t("guides.messages.noMaterialTarget");
    case "landmarksUnavailable":
      return t("guides.messages.landmarksUnavailable");
    case "hoverAnchorUnavailable":
      return t("guides.messages.hoverAnchorUnavailable");
    case "textureAnchorsUnavailable":
      return t("guides.messages.textureAnchorsUnavailable");
    case "estimatedAnchor":
      return t("guides.messages.estimatedAnchor");
    case "liveAnchorUnavailable":
      return t("guides.messages.liveAnchorUnavailable");
    case "estimatedFlatten":
      return t("guides.messages.estimatedFlatten");
    case "noTextureSurface":
      return t("guides.messages.noTextureSurface");
  }
}

/** The materials a texture effect paints, by name. */
export function materialTargetMessage(materials: readonly string[]): string {
  const t = getI18n().getFixedT(null, "effects");
  return t("guides.messages.target", { materials });
}

/**
 * A placement warning from the runtime (English diagnostic text): as it is in
 * English, else a worded summary with the English as detail.
 */
export function placementWarningMessage(warning: string): string {
  const t = getI18n().getFixedT(null, "effects");
  return apiErrorLine(
    uncodedErrorText(warning, t("guides.messages.anchorWarning")),
  );
}
