import type { ParticleVFXEditorDraft } from "@/lib/avatar/particle-vfx";
import { referencedParticleVFXTextureFiles } from "@/lib/avatar/particle-vfx/editor/textureFiles";

/**
 * Fingerprint editable typed Particle Effect content, excluding camera state.
 * Texture files count by content hash, and only while the effect uses them.
 */
export function particleVFXDocumentFingerprint(
  draft: ParticleVFXEditorDraft,
): string {
  const textures = Object.fromEntries(
    Object.entries(referencedParticleVFXTextureFiles(draft)).map(
      ([reference, file]) => [reference, file.sha256],
    ),
  );
  return JSON.stringify(
    canonicalJson({
      catalog: draft.catalog,
      quarksJson: draft.quarksJson,
      textures,
    }),
  );
}

/** History equality: equal authored content creates no undo step. */
export function equalParticleVFXDrafts(
  left: ParticleVFXEditorDraft,
  right: ParticleVFXEditorDraft,
): boolean {
  return (
    particleVFXDocumentFingerprint(left) ===
    particleVFXDocumentFingerprint(right)
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
