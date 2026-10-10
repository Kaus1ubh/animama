import type {
  PyContentDependency,
  PyContentPreview,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import { isNonPortable } from "@/lib/content/portability";

/** An effect's accompanying sound, as an editable draft stores it. */
export type PreviewSound = {
  alias: string;
  label: string;
  source: PyExactContentSource;
};

/**
 * Plain-language note for a copy that lost its built-in effect's licensed
 * sound. The sound plays with the built-in effect only.
 */
export const LICENSED_SOUND_NOTE =
  "The built-in sound plays only with the built-in effect, so this copy has no sound. You can choose one of your own.";

/**
 * The accompanying sound to copy from an effect preview into an editable
 * draft. A licensed built-in sound (non-portable) stays with the built-in
 * effect: it is never copied, and `licensedOmitted` lets the creator say so.
 */
export function previewSoundForCopy(preview: PyContentPreview): {
  sound: PreviewSound | null;
  licensedOmitted: boolean;
} {
  const dependencies = Array.isArray(preview.metadata.dependencies)
    ? preview.metadata.dependencies
    : [];
  const sounds = dependencies.filter((value): value is PyContentDependency =>
    Boolean(
      object(value)?.content_type === "sound_effect" &&
      typeof object(value)?.alias === "string" &&
      object(object(value)?.source)?.type,
    ),
  );
  const licensedOmitted = sounds.some((edge) => isNonPortable(object(edge)));
  const edge = sounds.find((value) => !isNonPortable(object(value)));
  if (!edge) return { sound: null, licensedOmitted };
  const supports = Array.isArray(preview.metadata.supports)
    ? preview.metadata.supports
    : [];
  const referenceMap = object(preview.metadata.reference_map);
  const runtimeId = referenceMap?.[edge.alias];
  const support = supports.find(
    (value) => object(value)?.runtime_id === runtimeId,
  );
  return {
    sound: {
      alias: edge.alias,
      label: String(object(support)?.name ?? edge.alias),
      source: edge.source,
    },
    licensedOmitted,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
