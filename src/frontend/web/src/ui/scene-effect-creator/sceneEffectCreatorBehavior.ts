import {
  createDefaultSceneEffectDocument,
  sceneEffectDocumentFingerprint,
  sceneEffectEditorReducer,
  type SceneEffectEditorDocument,
  type SceneEffectEditorImageResource,
} from "@/lib/scene-vfx/editor";

/** One undo step: the authored document and the private images it references. */
export type SceneEffectHistorySnapshot = {
  document: SceneEffectEditorDocument;
  imageResources: SceneEffectEditorImageResource[];
};

export function createSceneEffectHistorySnapshot(): SceneEffectHistorySnapshot {
  return { document: createDefaultSceneEffectDocument(), imageResources: [] };
}

/** Compare authored data and immutable File identities without serializing bytes. */
export function equalSceneEffectHistorySnapshots(
  left: SceneEffectHistorySnapshot,
  right: SceneEffectHistorySnapshot,
): boolean {
  return (
    sceneEffectDocumentFingerprint(left.document) ===
      sceneEffectDocumentFingerprint(right.document) &&
    left.imageResources.length === right.imageResources.length &&
    left.imageResources.every(
      (resource, index) =>
        resource.logicalName === right.imageResources[index]?.logicalName &&
        resource.sha256 === right.imageResources[index]?.sha256 &&
        resource.file === right.imageResources[index]?.file,
    )
  );
}

/**
 * Build one undoable edit from a reducer action. Omitting `imageResources`
 * keeps the current images; a list replaces them with the same step.
 */
export function sceneEffectHistoryEdit(
  action: Parameters<typeof sceneEffectEditorReducer>[1],
  imageResources?: SceneEffectEditorImageResource[],
): (snapshot: SceneEffectHistorySnapshot) => SceneEffectHistorySnapshot {
  return (snapshot) => ({
    document: sceneEffectEditorReducer(snapshot.document, action),
    imageResources: imageResources ?? snapshot.imageResources,
  });
}

/** Save and recovery fingerprint: the document plus its image digests. */
export function sceneEffectSnapshotFingerprint(
  snapshot: SceneEffectHistorySnapshot,
): string {
  const digests = [...snapshot.imageResources]
    .sort((left, right) => left.logicalName.localeCompare(right.logicalName))
    .map((resource) => `${resource.logicalName}:${resource.sha256}`)
    .join("|");
  return `${sceneEffectDocumentFingerprint(snapshot.document)}:${digests}`;
}

export type SceneEffectCreatorKeyboardAction = "save" | "toggle-preview" | null;

export function sceneEffectCreatorKeyboardAction(args: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  editing: boolean;
}): SceneEffectCreatorKeyboardAction {
  if ((args.metaKey || args.ctrlKey) && args.key.toLowerCase() === "s")
    return "save";
  if (!args.editing && args.code === "Space") return "toggle-preview";
  return null;
}

export const SCENE_EFFECT_PREVIEW_MOTION_CLASS =
  "motion-safe:animate-pulse motion-reduce:animate-none";

export function createSceneEffectObjectUrlLease(
  resources: readonly SceneEffectEditorImageResource[],
  api: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
): { urls: ReadonlyMap<string, string>; dispose: () => void } {
  const urls = new Map(
    resources.map((resource) => [
      resource.logicalName,
      api.createObjectURL(resource.file),
    ]),
  );
  let disposed = false;
  return {
    urls,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const url of urls.values()) api.revokeObjectURL(url);
    },
  };
}
