import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  addParticleVFXEditorEmitter,
  createParticleVFXEditorDraftFromBlank,
  removeParticleVFXEditorEmitter,
  updateParticleVFXEditorCatalogDraft,
  type ParticleVFXEditorDraft,
} from "@/lib/avatar/particle-vfx";
import { createDefaultAvatarEffectDocument } from "@/lib/avatar/vfx/editor";
import { createDefaultSceneEffectDocument } from "@/lib/scene-vfx/editor";
import {
  avatarEffectHistoryEdit,
  createAvatarEffectHistorySnapshot,
  equalAvatarEffectHistorySnapshots,
} from "@/ui/avatar-effect-creator/avatarEffectCreatorBehavior";
import { equalParticleVFXDrafts } from "@/ui/particle-vfx-creator/particleVFXDocument";
import {
  createSceneEffectHistorySnapshot,
  equalSceneEffectHistorySnapshots,
  sceneEffectHistoryEdit,
} from "@/ui/scene-effect-creator/sceneEffectCreatorBehavior";
import {
  useCreatorDocumentHistory,
  type CreatorDocumentHistory,
} from "./useCreatorDocumentHistory";

/**
 * Server rendering exposes the real history callbacks without a DOM; the
 * latest snapshot is read through `getSnapshot`.
 */
function mount<T>(
  initialValue: () => T,
  equals: (left: T, right: T) => boolean,
): CreatorDocumentHistory<T> {
  let editor!: CreatorDocumentHistory<T>;
  function Harness() {
    editor = useCreatorDocumentHistory({ initialValue, equals });
    return null;
  }
  renderToString(<Harness />);
  return editor;
}

describe("creator document history", () => {
  describe("Avatar Effect snapshots", () => {
    const create = () =>
      mount(
        createAvatarEffectHistorySnapshot,
        equalAvatarEffectHistorySnapshots,
      );

    it("undoes and redoes sequential edits without losing earlier ones", () => {
      const editor = create();
      const original = editor.getSnapshot().document;
      editor.update(
        avatarEffectHistoryEdit({ type: "patch", patch: { name: "Sparkle" } }),
      );
      editor.update(
        avatarEffectHistoryEdit({
          type: "patch",
          patch: { description: "Bright" },
        }),
      );
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

    it("restores image bytes together with the image metadata", () => {
      const editor = create();
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
      editor.update(
        avatarEffectHistoryEdit({ type: "patch", patch: { image } }, resource),
      );
      editor.update(
        avatarEffectHistoryEdit(
          { type: "replace", document: createDefaultAvatarEffectDocument() },
          null,
        ),
      );
      editor.history.undo();
      expect(editor.getSnapshot().document.image).toEqual(image);
      expect(editor.getSnapshot().imageResource?.file).toBe(file);
      editor.history.redo();
      expect(editor.getSnapshot().document.image).toBeNull();
      expect(editor.getSnapshot().imageResource).toBeNull();
    });

    it("resets at new, load and recovery boundaries", () => {
      const editor = create();
      editor.update(
        avatarEffectHistoryEdit({ type: "patch", patch: { name: "First" } }),
      );
      editor.history.undo();
      editor.update(
        avatarEffectHistoryEdit({ type: "patch", patch: { name: "Second" } }),
      );
      editor.history.redo();
      expect(editor.getSnapshot().document.name).toBe("Second");
      const loaded = {
        document: { ...createDefaultAvatarEffectDocument(), name: "Loaded" },
        imageResource: null,
      };
      editor.reset(loaded);
      editor.history.undo();
      editor.history.redo();
      expect(editor.getSnapshot()).toEqual(loaded);
    });
  });

  describe("Scene Effect snapshots", () => {
    const create = () =>
      mount(createSceneEffectHistorySnapshot, equalSceneEffectHistorySnapshots);

    it("undoes edits to separate layers in order", () => {
      const editor = create();
      const original = editor.getSnapshot().document;
      editor.update(
        sceneEffectHistoryEdit({
          type: "patch-solid",
          patch: { enabled: !original.background.solid.enabled },
        }),
      );
      const first = editor.getSnapshot().document;
      editor.update(
        sceneEffectHistoryEdit({
          type: "patch-pattern",
          patch: { enabled: !first.background.pattern.enabled },
        }),
      );
      editor.history.undo();
      expect(editor.getSnapshot().document).toEqual(first);
      editor.history.undo();
      expect(editor.getSnapshot().document).toEqual(original);
      editor.history.redo();
      expect(editor.getSnapshot().document).toEqual(first);
    });

    it("restores removed images and their exact Files together", () => {
      const editor = create();
      const file = new File(["image bytes"], "sparkle.webp", {
        type: "image/webp",
      });
      const resource = { logicalName: file.name, file, sha256: "sparkle-hash" };
      const item = {
        id: "sparkle",
        kind: "image" as const,
        label: "Sparkle",
        image: {
          logicalName: file.name,
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          sha256: resource.sha256,
        },
      };
      editor.update(
        sceneEffectHistoryEdit({ type: "set-marquee-items", items: [item] }, [
          resource,
        ]),
      );
      editor.update(
        sceneEffectHistoryEdit({ type: "set-marquee-items", items: [] }, []),
      );
      editor.history.undo();
      expect(editor.getSnapshot().document.background.marquee.items).toEqual([
        item,
      ]);
      expect(editor.getSnapshot().imageResources[0]?.file).toBe(file);
      editor.history.redo();
      expect(editor.getSnapshot().imageResources).toEqual([]);
    });

    it("allows undoing an import and ignores value-equal edits", () => {
      const editor = create();
      editor.update(
        sceneEffectHistoryEdit({ type: "patch", patch: { name: "First" } }),
      );
      const imported = {
        ...createDefaultSceneEffectDocument(),
        name: "Imported",
      };
      editor.update(
        sceneEffectHistoryEdit({ type: "replace", document: imported }, []),
      );
      editor.history.undo();
      expect(editor.getSnapshot().document.name).toBe("First");
      editor.update(
        sceneEffectHistoryEdit({ type: "patch", patch: { name: "Second" } }),
      );
      editor.history.undo();
      // Re-applying the current value creates no step and keeps redo.
      editor.update(
        sceneEffectHistoryEdit({ type: "patch", patch: { name: "First" } }),
      );
      editor.history.redo();
      expect(editor.getSnapshot().document.name).toBe("Second");
    });
  });

  describe("Particle Effect drafts", () => {
    const create = () =>
      mount<ParticleVFXEditorDraft>(
        createParticleVFXEditorDraftFromBlank,
        equalParticleVFXDrafts,
      );

    it("restores emitter removal and discards a branched redo", () => {
      const editor = create();
      editor.update(addParticleVFXEditorEmitter);
      const added = editor.getSnapshot();
      editor.update((draft) =>
        removeParticleVFXEditorEmitter(draft, added.emitters[0]!.path),
      );
      editor.history.undo();
      expect(editor.getSnapshot()).toEqual(added);
      editor.update((draft) =>
        updateParticleVFXEditorCatalogDraft(draft, { label: "Branch" }),
      );
      editor.history.redo();
      expect(editor.getSnapshot().catalog.label).toBe("Branch");
      expect(editor.getSnapshot().emitters).toEqual(added.emitters);
    });

    it("keeps undo across save normalization and clears it on reset", () => {
      const editor = create();
      const initial = editor.getSnapshot();
      editor.update((draft) =>
        updateParticleVFXEditorCatalogDraft(draft, { label: "Saved" }),
      );
      editor.history.replacePresent({
        ...editor.getSnapshot(),
        source: "imported",
      });
      editor.history.undo();
      expect(editor.getSnapshot()).toEqual(initial);
      editor.history.redo();
      expect(editor.getSnapshot().catalog.label).toBe("Saved");
      const next = updateParticleVFXEditorCatalogDraft(initial, {
        label: "Loaded",
      });
      editor.reset(next);
      editor.history.undo();
      editor.history.redo();
      expect(editor.getSnapshot()).toEqual(next);
    });
  });
});
