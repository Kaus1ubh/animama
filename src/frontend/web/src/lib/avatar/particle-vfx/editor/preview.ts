import {
  getParticleVFXCombinedOffset,
  normalizeParticleVFXTransform,
  resolveParticleVFXAnchorLocalPosition,
} from "../runtime";
import type { Avatar } from "../../Avatar";
import { resolveParticleVFXAvatarBoundsRectangleFit } from "../autoFit";
import type {
  ParticleVFXAnchor,
  ParticleVFXShapeAutoFit,
  ParticleVFXTransform,
} from "../types";
import { cloneJsonObject, readJsonObject } from "./json";
import { PARTICLE_VFX_EDITOR_TEXTURES } from "./constants";
import { resolveParticleVFXPublicAssetPath } from "./textures";
import type {
  JsonObject,
  ParticleVFXCreatorPreviewPlacement,
  ParticleVFXEditorDraft,
} from "./types";

export function resolveParticleVFXEditorPreviewJson(
  draft: ParticleVFXEditorDraft,
  logicalResourceUrls?:
    | ReadonlyMap<string, string>
    | ((logicalReference: string) => string | null | undefined),
): JsonObject {
  const json = cloneJsonObject(draft.quarksJson);
  const images = Array.isArray(json.images) ? json.images : [];
  for (const image of images) {
    const object = readJsonObject(image);
    if (!object || typeof object.url !== "string") continue;
    if (logicalResourceUrls) {
      const resolved =
        typeof logicalResourceUrls === "function"
          ? logicalResourceUrls(object.url)
          : logicalResourceUrls.get(object.url);
      const curated = PARTICLE_VFX_EDITOR_TEXTURES.find(
        (texture) => texture.relativeUrl === object.url,
      );
      if (!resolved && !curated) {
        throw new Error(`Particle VFX texture ${object.url} is unavailable.`);
      }
      object.url = resolved ?? curated!.publicUrl;
    } else {
      const curated = PARTICLE_VFX_EDITOR_TEXTURES.find(
        (texture) => texture.relativeUrl === object.url,
      );
      object.url =
        curated?.publicUrl ??
        resolveParticleVFXPublicAssetPath(
          draft.sourceAssetPath || draft.catalog.assetPath,
          object.url,
        );
    }
  }
  return json;
}

export function resolveParticleVFXCreatorPreviewPlacement(args: {
  avatar: Avatar | null | undefined;
  anchor: ParticleVFXAnchor;
  transform: ParticleVFXTransform | null | undefined;
  shapeAutoFit?: ParticleVFXShapeAutoFit | null;
}): ParticleVFXCreatorPreviewPlacement {
  const transform = normalizeParticleVFXTransform(args.transform);
  if (args.avatar && args.shapeAutoFit) {
    const autoFitResult = resolveParticleVFXAvatarBoundsRectangleFit({
      avatar: args.avatar,
      transform,
      shapeAutoFit: args.shapeAutoFit,
    });
    if (autoFitResult.fit) {
      return {
        position: autoFitResult.fit.position,
        rotation: { ...transform.rotation },
        scale: { ...transform.scale },
        resolvedAnchor: args.anchor,
        boneName: null,
        warning: autoFitResult.warning,
        autoFit: {
          kind: "avatarBoundsRectangle",
          width: autoFitResult.fit.width,
          height: autoFitResult.fit.height,
        },
      };
    }
  }

  const resolved = args.avatar
    ? resolveParticleVFXAnchorLocalPosition({
        avatar: args.avatar,
        anchor: args.anchor,
        transform,
      })
    : null;
  const fallbackPosition = getParticleVFXCombinedOffset(transform);

  return {
    position: resolved?.position ?? fallbackPosition,
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
    resolvedAnchor: resolved?.resolvedAnchor ?? null,
    boneName: resolved?.boneName ?? null,
    warning:
      resolved?.warning ??
      (args.avatar
        ? null
        : "Preview avatar is not available; using root transform."),
    autoFit: null,
  };
}
