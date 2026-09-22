import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDefaultSceneEffectDocument } from "@/lib/scene-vfx/editor";
import { useSceneEffectHistory } from "./useSceneEffectHistory";

/** Exercise authored state without a WebGL canvas or unrelated server queries. */
function createHistory() {
  let result!: ReturnType<typeof useSceneEffectHistory>;
  function Harness() {
    result = useSceneEffectHistory();
    return null;
  }
  renderToString(<Harness />);
  return result;
}

describe("Scene FX authored history", () => {
  it("undoes edits to separate layers in order and redoes them", () => {
    const editor = createHistory();
    const original = editor.getSnapshot().document;
    editor.dispatch({
      type: "patch-solid",
      patch: { enabled: !original.background.solid.enabled },
    });
    const first = editor.getSnapshot().document;
    editor.dispatch({
      type: "patch-pattern",
      patch: { enabled: !first.background.pattern.enabled },
    });
    editor.history.undo();
    expect(editor.getSnapshot().document).toEqual(first);
    editor.history.undo();
    expect(editor.getSnapshot().document).toEqual(original);
    editor.history.redo();
    expect(editor.getSnapshot().document).toEqual(first);
  });

  it("restores removed image entries and their exact File resources together", () => {
    const editor = createHistory();
    const file = new File(["image bytes"], "sparkle.webp", {
      type: "image/webp",
    });
    const resource = { logicalName: file.name, file, sha256: "sparkle-hash" };
    const image = {
      logicalName: file.name,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      sha256: resource.sha256,
    };
    const item = {
      id: "sparkle",
      kind: "image" as const,
      label: "Sparkle",
      image,
    };
    editor.dispatch({ type: "set-marquee-items", items: [item] }, [resource]);
    editor.dispatch({ type: "set-marquee-items", items: [] }, []);
    editor.history.undo();
    expect(editor.getSnapshot().document.background.marquee.items).toEqual([
      item,
    ]);
    expect(editor.getSnapshot().imageResources[0]?.file).toBe(file);
    editor.history.redo();
    expect(editor.getSnapshot().document.background.marquee.items).toEqual([]);
    expect(editor.getSnapshot().imageResources).toEqual([]);
  });

  it("allows undoing imports and resets undo/redo only at document boundaries", () => {
    const editor = createHistory();
    editor.dispatch({ type: "patch", patch: { name: "First" } });
    const imported = {
      ...createDefaultSceneEffectDocument(),
      name: "Imported",
    };
    editor.dispatch({ type: "replace", document: imported }, []);
    editor.history.undo();
    expect(editor.getSnapshot().document.name).toBe("First");
    editor.dispatch({ type: "patch", patch: { name: "Another edit" } });
    editor.history.redo();
    expect(editor.getSnapshot().document.name).toBe("Another edit");
    editor.resetDocument(imported, []);
    editor.history.undo();
    editor.history.redo();
    expect(editor.getSnapshot().document).toEqual(imported);
  });

  it("ignores value-equivalent edits without consuming a redo step", () => {
    const editor = createHistory();
    editor.dispatch({ type: "patch", patch: { name: "First" } });
    editor.dispatch({ type: "patch", patch: { name: "Second" } });
    editor.history.undo();
    editor.dispatch({ type: "patch", patch: { name: "First" } });
    editor.history.redo();
    expect(editor.getSnapshot().document.name).toBe("Second");
  });
});
