import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultAvatarEffectDocument } from "@/lib/avatar/vfx/editor";
import { useAvatarEffectHistory } from "./useAvatarEffectHistory";

/** Exercise the hook's imperative history contract without mounting a canvas. */
function createHistory() {
  let result!: ReturnType<typeof useAvatarEffectHistory>;
  function Harness() {
    result = useAvatarEffectHistory();
    return null;
  }
  renderToString(<Harness />);
  return result;
}

describe("Avatar FX authored history", () => {
  it("undoes and redoes sequential reducer edits without losing earlier edits", () => {
    const editor = createHistory();
    const original = editor.getSnapshot().document;
    editor.dispatch({ type: "patch", patch: { name: "Sparkle" } });
    editor.dispatch({ type: "patch", patch: { description: "Bright" } });
    editor.history.undo();
    expect(editor.getSnapshot().document).toEqual({
      ...original,
      name: "Sparkle",
    });
    editor.history.undo();
    expect(editor.getSnapshot().document).toEqual(original);
    editor.history.redo();
    expect(editor.getSnapshot().document.name).toBe("Sparkle");
  });

  it("restores image bytes atomically with the image metadata after import", () => {
    const editor = createHistory();
    const file = new File(["image bytes"], "sparkle.webp", {
      type: "image/webp",
    });
    const resource = { file, sha256: "sparkle-hash" };
    const image = {
      logicalName: file.name,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      sha256: resource.sha256,
    };
    editor.dispatch({ type: "patch", patch: { image } }, resource);
    editor.dispatch(
      { type: "replace", document: createDefaultAvatarEffectDocument() },
      null,
    );
    editor.history.undo();
    expect(editor.getSnapshot().document.image).toEqual(image);
    expect(editor.getSnapshot().imageResource?.file).toBe(file);
    editor.history.redo();
    expect(editor.getSnapshot().document.image).toBeNull();
    expect(editor.getSnapshot().imageResource).toBeNull();
  });

  it("resets history at new/load/recovery boundaries and drops redo after a new edit", () => {
    const editor = createHistory();
    editor.dispatch({ type: "patch", patch: { name: "First" } });
    editor.history.undo();
    editor.dispatch({ type: "patch", patch: { name: "Second" } });
    editor.history.redo();
    expect(editor.getSnapshot().document.name).toBe("Second");
    const loaded = { ...createDefaultAvatarEffectDocument(), name: "Loaded" };
    editor.resetDocument(loaded, null);
    editor.history.undo();
    editor.history.redo();
    expect(editor.getSnapshot().document).toEqual(loaded);
  });
});
