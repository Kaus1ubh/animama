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

  it("changes when a texture the effect uses gets new bytes, not when an unused one does", () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const reference = "textures/glyph-1.png";
    (draft.quarksJson.images as { url: string }[])[0]!.url = reference;
    const file = (sha256: string) => ({
      blob: new Blob([]),
      sha256,
      width: 1,
      height: 1,
    });
    const supplied = { ...draft, textureFiles: { [reference]: file("a") } };
    const replaced = { ...draft, textureFiles: { [reference]: file("b") } };
    const unused = {
      ...supplied,
      textureFiles: {
        ...supplied.textureFiles,
        "textures/other-1.png": file("c"),
      },
    };

    expect(particleVFXDocumentFingerprint(supplied)).not.toBe(
      particleVFXDocumentFingerprint(draft),
    );
    expect(particleVFXDocumentFingerprint(replaced)).not.toBe(
      particleVFXDocumentFingerprint(supplied),
    );
    expect(particleVFXDocumentFingerprint(unused)).toBe(
      particleVFXDocumentFingerprint(supplied),
    );
  });
});
