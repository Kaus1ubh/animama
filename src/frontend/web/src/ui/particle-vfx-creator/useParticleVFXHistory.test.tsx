import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  addParticleVFXEditorEmitter,
  createParticleVFXEditorDraftFromBlank,
  removeParticleVFXEditorEmitter,
  updateParticleVFXEditorCatalogDraft,
} from "@/lib/avatar/particle-vfx";
import { useParticleVFXHistory } from "./useParticleVFXHistory";

/** Server rendering exposes real history callbacks without a mocked reducer. */
function session() {
  let editor!: ReturnType<typeof useParticleVFXHistory>;
  function Probe() {
    editor = useParticleVFXHistory(createParticleVFXEditorDraftFromBlank());
    return null;
  }
  renderToString(<Probe />);
  return { editor, read: editor.getSnapshot };
}

describe("Particle authoring history", () => {
  it("restores emitter removal and catalog edits and discards a branched redo", () => {
    const { editor, read } = session();
    editor.updateDraft(addParticleVFXEditorEmitter);
    const added = read();
    editor.updateDraft((draft) =>
      removeParticleVFXEditorEmitter(draft, added.emitters[0]!.path),
    );
    expect(read().emitters).toHaveLength(added.emitters.length - 1);
    editor.history.undo();
    expect(read()).toEqual(added);
    editor.history.redo();
    expect(read().emitters).toHaveLength(added.emitters.length - 1);
    editor.history.undo();
    editor.updateDraft((draft) =>
      updateParticleVFXEditorCatalogDraft(draft, { label: "Branch" }),
    );
    editor.history.redo();
    expect(read().catalog.label).toBe("Branch");
    expect(read().emitters).toEqual(added.emitters);
  });

  it("preserves history across save normalization and clears it on document reset", () => {
    const { editor, read } = session();
    const initial = read();
    editor.updateDraft((draft) =>
      updateParticleVFXEditorCatalogDraft(draft, { label: "Saved" }),
    );
    editor.history.replacePresent({ ...read(), source: "imported" });
    editor.history.undo();
    expect(read()).toEqual(initial);
    editor.history.redo();
    expect(read().catalog.label).toBe("Saved");
    const next = updateParticleVFXEditorCatalogDraft(initial, {
      label: "Loaded",
    });
    editor.resetDraft(next);
    editor.history.undo();
    editor.history.redo();
    expect(read()).toEqual(next);
  });
});
