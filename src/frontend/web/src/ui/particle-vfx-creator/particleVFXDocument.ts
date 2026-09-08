import type { ParticleVFXEditorDraft } from "@/lib/avatar/particle-vfx";

/** Fingerprint editable typed Particle Effect content, excluding camera state. */
export function particleVFXDocumentFingerprint(
  draft: ParticleVFXEditorDraft,
): string {
  return JSON.stringify(
    canonicalJson({ catalog: draft.catalog, quarksJson: draft.quarksJson }),
  );
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}
