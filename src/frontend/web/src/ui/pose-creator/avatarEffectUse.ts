import type { AvatarEffectDefinitionV2 } from "@animama/runtime-contracts/api-types";
import { compareDisplayText } from "@animama/product-ui/i18n";

import type { AnimaPoseClipAvatarVFXOverride } from "@/lib/avatar/poses/animaPoseClip";
import {
  AvatarEffectDefinitionError,
  applyAvatarEffectOverride,
  parseAvatarEffectDefinition,
  validateAvatarEffectDefinition,
  type AvatarEffectEntryContext,
} from "@/lib/avatar/vfx/definition";
import {
  avatarEffectDefinition,
  avatarEffectEditorReducer,
  canonicalJson,
  createAvatarEffectDocumentFromDefinition,
  type AvatarEffectEditorAction,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImage,
} from "@/lib/avatar/vfx/editor";
import {
  avatarVFXEffectTransformOf,
  type AvatarVFXEffectTransform,
} from "@/lib/avatar/vfx/types";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";

/** One of an effect's declared sounds, as the sound picker offers it. */
export type AvatarEffectUseSound = { alias: string; label: string };

/** What the Action creator knows about the effect an `avatar_vfx` event plays. */
export type AvatarEffectUseSource = {
  definition: AvatarEffectDefinitionV2;
  /** Declared sounds that are mounted, the effect's default first. */
  sounds: readonly AvatarEffectUseSound[];
};

/** The result of one edit to a use: its new override, or why it was refused. */
export type AvatarEffectUseEdit =
  | { override: AnimaPoseClipAvatarVFXOverride | undefined }
  | { error: unknown };

/**
 * The effect an event names in the mounted runtime, with its declared sounds:
 * the aliases in its reference map that resolve to mounted sound entries.
 * Null when the effect or a valid `/2` definition is unavailable.
 */
export function avatarEffectUseSource(
  runtime: AnimaRuntimeCatalogSnapshot | null,
  effectId: string,
): AvatarEffectUseSource | null {
  const entry = runtime?.avatar_vfx.find(
    (candidate) => candidate.runtime_id === effectId,
  );
  if (!entry || entry.definition_error) return null;
  let definition: AvatarEffectDefinitionV2;
  try {
    definition = validateAvatarEffectDefinition(entry.definition);
  } catch {
    return null;
  }
  const references = entry.config.runtime_reference_map;
  const sounds = Object.entries(
    references && typeof references === "object"
      ? (references as Record<string, unknown>)
      : {},
  ).flatMap(([alias, runtimeId]) => {
    const sound = runtime?.sfx.find(
      (candidate) => candidate.runtime_id === String(runtimeId),
    );
    return sound ? [{ alias, label: sound.display_name }] : [];
  });
  sounds.sort(
    (left, right) =>
      Number(right.alias === definition.soundAlias) -
        Number(left.alias === definition.soundAlias) ||
      compareDisplayText(left.label, right.label) ||
      left.alias.localeCompare(right.alias),
  );
  return { definition, sounds };
}

/** Image metadata for art the use cannot change; only its name is read. */
function namedImage(logicalName: string): AvatarEffectEditorImage {
  return {
    logicalName,
    originalName: logicalName,
    contentType: "image/png",
    sizeBytes: 0,
    sha256: null,
  };
}

/**
 * The Avatar Effect creator's document for one use: the effect's definition
 * with the event's override applied. Throws
 * {@link AvatarEffectDefinitionError} when the effect cannot play the override.
 */
export function avatarEffectUseDocument(
  definition: AvatarEffectDefinitionV2,
  override?: AnimaPoseClipAvatarVFXOverride,
): AvatarEffectEditorDocument {
  const played = override
    ? applyAvatarEffectOverride(definition, override)
    : definition;
  return createAvatarEffectDocumentFromDefinition({
    name: "",
    description: "",
    definition: played,
    image: namedImage(played.art.image),
    otherEyeImage: played.art.otherEyeImage
      ? namedImage(played.art.otherEyeImage)
      : null,
    sound: null,
  });
}

/** JSON with sorted keys, so equal parts compare equal whatever their order. */
function canonical(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

/** Whether two overrides (or their absence) say the same, whatever their key order. */
export function sameAvatarEffectOverride(
  left: AnimaPoseClipAvatarVFXOverride | undefined,
  right: AnimaPoseClipAvatarVFXOverride | undefined,
): boolean {
  return canonical(left ?? null) === canonical(right ?? null);
}

/**
 * The smallest override that plays the effect as `document` shows it. Both
 * sides are compared in the form the creator saves, so an unedited part (or
 * one edited back) is left out. A changed part is written whole, as an
 * override part replaces the effect's; a removed look or motion is `{}`. A
 * sound is kept only when it differs from the effect's. Undefined when the
 * use plays the effect unchanged.
 */
export function avatarEffectUseOverride(
  definition: AvatarEffectDefinitionV2,
  document: AvatarEffectEditorDocument,
  soundAlias?: string,
): AnimaPoseClipAvatarVFXOverride | undefined {
  const effect = avatarEffectDefinition(avatarEffectUseDocument(definition));
  const use = avatarEffectDefinition(document);
  const override: AnimaPoseClipAvatarVFXOverride = {};
  if (canonical(use.attachment) !== canonical(effect.attachment))
    override.attachment = use.attachment;
  if (canonical(use.appearance ?? {}) !== canonical(effect.appearance ?? {}))
    override.appearance = use.appearance ?? {};
  if (canonical(use.motion ?? {}) !== canonical(effect.motion ?? {}))
    override.motion = use.motion ?? {};
  if (soundAlias !== undefined && soundAlias !== definition.soundAlias)
    override.soundAlias = soundAlias;
  return Object.keys(override).length ? override : undefined;
}

/**
 * Apply one creator control's change (or a sound choice) to a use and return
 * its new minimal override. An edit the effect cannot play (for example a
 * placement its face options or other-eye art do not suit) is refused with
 * the definition error, so the event keeps its last playable override.
 */
export function editAvatarEffectUse(
  definition: AvatarEffectDefinitionV2,
  override: AnimaPoseClipAvatarVFXOverride | undefined,
  change: { action: AvatarEffectEditorAction } | { soundAlias: string },
): AvatarEffectUseEdit {
  try {
    const current = avatarEffectUseDocument(definition, override);
    const document =
      "action" in change
        ? avatarEffectEditorReducer(current, change.action)
        : current;
    const next = avatarEffectUseOverride(
      definition,
      document,
      "soundAlias" in change ? change.soundAlias : override?.soundAlias,
    );
    // The same checks playback makes.
    if (next) parseUse(definition, next);
    return { override: next };
  } catch (error) {
    return { error };
  }
}

/** Stand-in resources: parsing a use for checks and placement needs no art. */
const USE_CONTEXT: AvatarEffectEntryContext = {
  id: "action-creator-effect-use",
  label: "",
  description: "",
  assetPath: "blob:action-creator-effect-use",
  otherEyeAssetPath: "blob:action-creator-effect-use-other-eye",
};

function parseUse(
  definition: AvatarEffectDefinitionV2,
  override: AnimaPoseClipAvatarVFXOverride | undefined,
) {
  return parseAvatarEffectDefinition(
    override ? applyAvatarEffectOverride(definition, override) : definition,
    USE_CONTEXT,
  );
}

/**
 * Where a use draws its art, as `AvatarVFXController.updateEffectTransform`
 * moves an applied effect in place (null for a silhouette). Throws
 * {@link AvatarEffectDefinitionError} when the effect cannot play the use.
 */
export function avatarEffectUseTransform(
  definition: AvatarEffectDefinitionV2,
  override: AnimaPoseClipAvatarVFXOverride | undefined,
): AvatarVFXEffectTransform | null {
  return avatarVFXEffectTransformOf(parseUse(definition, override));
}

/**
 * The definition path (below `definition`) a refused use names, for the
 * creator's setting labels; null when the error names none.
 */
export function avatarEffectUseErrorField(error: unknown): string | null {
  if (!(error instanceof AvatarEffectDefinitionError) || !error.field)
    return null;
  return error.field.replace(/^(definition|override)\.?/, "") || null;
}
