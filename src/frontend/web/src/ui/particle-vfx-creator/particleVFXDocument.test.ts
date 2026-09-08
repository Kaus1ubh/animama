import { describe, expect, it } from "vitest";

import { createParticleVFXEditorDraftFromBlank } from "@/lib/avatar/particle-vfx";
import { particleVFXDocumentFingerprint } from "./particleVFXDocument";

describe("typed Particle Effect document", () => {
  it("fingerprints equivalent editable documents deterministically", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const copy = structuredClone(draft);

    expect(particleVFXDocumentFingerprint(copy)).toBe(
      particleVFXDocumentFingerprint(draft),
    );
  });

  it("changes the recovery fingerprint when authored content changes", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const renamed = {
      ...draft,
      catalog: { ...draft.catalog, label: "A different particle effect" },
    };

    expect(particleVFXDocumentFingerprint(renamed)).not.toBe(
      particleVFXDocumentFingerprint(draft),
    );
  });
});
