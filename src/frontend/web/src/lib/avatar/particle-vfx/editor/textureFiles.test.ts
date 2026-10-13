import { describe, expect, it } from "vitest";

import { PARTICLE_TEXTURE_LIMITS } from "@/lib/effects/effectArtLimits";
import { PARTICLE_VFX_EDITOR_TEXTURES } from "./constants";
import {
  addParticleVFXEditorEmitter,
  applyParticleVFXEmitterPatch,
  createParticleVFXEditorDraftFromBlank,
  createParticleVFXEditorDraftFromImport,
  duplicateParticleVFXEditorEmitter,
} from "./draft";
import {
  extractEmbeddedParticleVFXTextures,
  importParticleVFXTextureFile,
  loadParticleVFXTextureFiles,
  missingParticleVFXTextureReferences,
  readParticleVFXTextureFile,
  referencedParticleVFXTextureFiles,
  supplyParticleVFXTextureFile,
} from "./textureFiles";
import type { ParticleVFXEditorTextureFile } from "./types";
import { validateParticleVFXEditorDraft } from "./validation";

/** Bytes that start like a PNG declaring `width`×`height`. */
function pngBytes(
  width: number,
  height: number,
  size = 64,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(Math.max(size, 33)));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function png(width: number, height: number, name = "art.png", size = 64) {
  return new File([pngBytes(width, height, size)], name, {
    type: "image/png",
  });
}

async function textureFile(
  width = 64,
  height = 64,
): Promise<ParticleVFXEditorTextureFile> {
  const read = await readParticleVFXTextureFile(png(width, height));
  if (!read.ok) throw new Error(read.message);
  return read.file;
}

/** A Quarks document whose one emitter uses `url`. */
function documentWithTexture(url: string) {
  const draft = createParticleVFXEditorDraftFromBlank();
  const json = structuredClone(draft.quarksJson) as {
    images: { url: string }[];
  };
  json.images[0]!.url = url;
  return json;
}

describe("Particle texture files", () => {
  it("keeps a texture that is not built in and reports it missing until supplied", async () => {
    const draft = createParticleVFXEditorDraftFromImport(
      documentWithTexture("textures/custom-heart.png"),
    );
    expect(draft.emitters[0]!.textureUrl).toBe("textures/custom-heart.png");
    expect(draft.emitters[0]!.textureId).toBeNull();
    expect(missingParticleVFXTextureReferences(draft)).toEqual([
      "textures/custom-heart.png",
    ]);

    const supplied = supplyParticleVFXTextureFile(
      draft,
      "textures/custom-heart.png",
      await textureFile(),
    );
    expect(supplied.ok).toBe(true);
    if (!supplied.ok) return;
    expect(missingParticleVFXTextureReferences(supplied.draft)).toEqual([]);
    expect(supplied.draft.quarksJson).toEqual(draft.quarksJson);
  });

  it("imports a PNG for an emitter under a reference no built-in texture uses", async () => {
    const draft = createParticleVFXEditorDraftFromBlank();
    const emitter = draft.emitters[0]!;
    const read = await readParticleVFXTextureFile(png(128, 64, "heart.png"));
    expect(read).toMatchObject({ ok: true, file: { width: 128, height: 64 } });
    if (!read.ok) return;

    const imported = importParticleVFXTextureFile(
      draft,
      emitter.path,
      "heart.png",
      read.file,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const next = imported.draft.emitters[0]!;
    expect(next.textureUrl).toBe(imported.reference);
    expect(
      PARTICLE_VFX_EDITOR_TEXTURES.map((texture) => texture.relativeUrl),
    ).not.toContain(imported.reference);
    expect(imported.reference).toMatch(/^textures\/heart-\d+\.png$/);
    expect(next.renderer.uTileCount).toBe(1);
    expect(next.renderer.vTileCount).toBe(1);
    expect(next.frameOverLife.mode).toBe("off");
    expect(
      Object.keys(referencedParticleVFXTextureFiles(imported.draft)),
    ).toEqual([imported.reference]);

    // A second import of the same file name gets its own reference, so undo
    // and redo never change the bytes behind an existing reference.
    const again = importParticleVFXTextureFile(
      imported.draft,
      emitter.path,
      "heart.png",
      read.file,
    );
    expect(again.ok && again.reference).not.toBe(imported.reference);
  });

  it("refuses oversized, malformed and non-PNG files, naming the limit", async () => {
    const tooLarge = await readParticleVFXTextureFile(
      png(64, 64, "big.png", PARTICLE_TEXTURE_LIMITS.bytes + 1),
    );
    expect(tooLarge).toMatchObject({ ok: false });
    expect(!tooLarge.ok && tooLarge.message).toContain("4 MiB");

    const tooWide = await readParticleVFXTextureFile(png(2049, 8));
    expect(!tooWide.ok && tooWide.message).toContain("2048 px");

    const jpeg = await readParticleVFXTextureFile(
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], "a.jpg"),
    );
    expect(!jpeg.ok && jpeg.message).toContain("PNG");

    const garbage = await readParticleVFXTextureFile(
      new File([new Uint8Array(40)], "a.png"),
    );
    expect(!garbage.ok && garbage.message).toContain("PNG");
  });

  it("refuses an import past the per-effect texture count or byte total", async () => {
    let draft = createParticleVFXEditorDraftFromBlank();
    const file = await textureFile();
    // One built-in texture plus fifteen imported ones fill the effect.
    for (let index = 0; index < PARTICLE_TEXTURE_LIMITS.count - 1; index += 1) {
      draft = addParticleVFXEditorEmitter(draft);
      const emitter = draft.emitters.at(-1)!;
      const imported = importParticleVFXTextureFile(
        draft,
        emitter.path,
        `art-${index}.png`,
        file,
      );
      if (!imported.ok) throw new Error(imported.message);
      draft = imported.draft;
    }
    draft = addParticleVFXEditorEmitter(draft);
    const refused = importParticleVFXTextureFile(
      draft,
      draft.emitters.at(-1)!.path,
      "one-more.png",
      file,
    );
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.message).toContain("16 textures");

    const heavy: ParticleVFXEditorTextureFile = {
      ...file,
      blob: new Blob([new Uint8Array(PARTICLE_TEXTURE_LIMITS.totalBytes + 1)]),
    };
    const blank = createParticleVFXEditorDraftFromBlank();
    const overTotal = importParticleVFXTextureFile(
      blank,
      blank.emitters[0]!.path,
      "heavy.png",
      heavy,
    );
    expect(!overTotal.ok && overTotal.message).toContain("32 MiB");
  });

  it("keeps an emitter's own texture when it is duplicated or followed by a new emitter", async () => {
    const blank = createParticleVFXEditorDraftFromBlank();
    const imported = importParticleVFXTextureFile(
      blank,
      blank.emitters[0]!.path,
      "glyph.png",
      await textureFile(),
    );
    if (!imported.ok) throw new Error(imported.message);
    const duplicated = duplicateParticleVFXEditorEmitter(
      imported.draft,
      imported.draft.emitters[0]!.path,
    );
    expect(duplicated.emitters.map((emitter) => emitter.textureUrl)).toEqual([
      imported.reference,
      imported.reference,
    ]);
    const added = addParticleVFXEditorEmitter(imported.draft);
    expect(added.emitters.at(-1)!.textureUrl).toBe(imported.reference);
    expect(added.textureFiles[imported.reference]).toBeDefined();
  });

  it("switching back to a built-in texture keeps working", async () => {
    const blank = createParticleVFXEditorDraftFromBlank();
    const imported = importParticleVFXTextureFile(
      blank,
      blank.emitters[0]!.path,
      "glyph.png",
      await textureFile(),
    );
    if (!imported.ok) throw new Error(imported.message);
    const builtIn = applyParticleVFXEmitterPatch(
      imported.draft,
      imported.draft.emitters[0]!.path,
      { textureId: "heart" },
    );
    expect(builtIn.emitters[0]!.textureId).toBe("heart");
    expect(referencedParticleVFXTextureFiles(builtIn)).toEqual({});
  });

  it("turns embedded image data in imported JSON into texture files", async () => {
    const encoded = btoa(String.fromCharCode(...pngBytes(32, 16)));
    const json = documentWithTexture(`data:image/png;base64,${encoded}`);
    const extracted = await extractEmbeddedParticleVFXTextures(json);
    expect(extracted.refused).toEqual([]);
    const draft = createParticleVFXEditorDraftFromImport(
      extracted.json,
      {},
      extracted.textureFiles,
    );
    const reference = draft.emitters[0]!.textureUrl!;
    expect(reference).toMatch(/^textures\/embedded-1\.png$/);
    expect(draft.textureFiles[reference]).toMatchObject({
      width: 32,
      height: 16,
    });
    expect(missingParticleVFXTextureReferences(draft)).toEqual([]);

    const bad = await extractEmbeddedParticleVFXTextures(
      documentWithTexture("data:image/png;base64,AAAA"),
    );
    expect(bad.refused).toHaveLength(1);
  });

  it("treats an imported sheet's tile counts as its atlas, up to 16 per side", async () => {
    const blank = createParticleVFXEditorDraftFromBlank();
    const imported = importParticleVFXTextureFile(
      blank,
      blank.emitters[0]!.path,
      "sheet.png",
      await textureFile(256, 256),
    );
    if (!imported.ok) throw new Error(imported.message);
    const path = imported.draft.emitters[0]!.path;
    const animated = applyParticleVFXEmitterPatch(imported.draft, path, {
      renderer: { uTileCount: 4, vTileCount: 4 },
      frameOverLifeDraft: { mode: "linear", startFrame: 0, endFrame: 15 },
    });
    const codes = (draft: typeof animated) =>
      validateParticleVFXEditorDraft(draft).map((issue) => issue.code);
    expect(codes(animated)).not.toContain("frame-over-life-without-atlas");
    expect(codes(animated)).not.toContain("atlas-grid-limit");
    const tooFine = applyParticleVFXEmitterPatch(animated, path, {
      renderer: { uTileCount: 17 },
    });
    expect(codes(tooFine)).toContain("atlas-grid-limit");
  });

  it("names extracted textures so they never reuse a reference already in use", async () => {
    const encoded = btoa(String.fromCharCode(...pngBytes(8, 8)));
    const json = documentWithTexture(`data:image/png;base64,${encoded}`);
    const extracted = await extractEmbeddedParticleVFXTextures(json, [
      "textures/embedded-1.png",
    ]);
    expect(Object.keys(extracted.textureFiles)).toEqual([
      "textures/embedded-2.png",
    ]);
  });

  it("matches built-in textures by their exact path only", () => {
    const draft = createParticleVFXEditorDraftFromImport(
      documentWithTexture("images/heart.png"),
    );
    expect(draft.emitters[0]!.textureId).toBeNull();
    expect(missingParticleVFXTextureReferences(draft)).toEqual([
      "images/heart.png",
    ]);
    const builtIn = createParticleVFXEditorDraftFromImport(
      documentWithTexture("textures/heart.png"),
    );
    expect(builtIn.emitters[0]!.textureId).toBe("heart");
  });

  it("loads a saved effect's texture files and fails on one over the limits", async () => {
    const loaded = await loadParticleVFXTextureFiles([
      {
        logicalPath: "textures/a.png",
        download: async () => png(16, 8),
      },
    ]);
    expect(loaded["textures/a.png"]).toMatchObject({ width: 16, height: 8 });
    await expect(
      loadParticleVFXTextureFiles([
        {
          logicalPath: "textures/wide.png",
          download: async () => png(4096, 8),
        },
      ]),
    ).rejects.toThrow("textures/wide.png: Textures must be at most 2048 px");
  });
});
