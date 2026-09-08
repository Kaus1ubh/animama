import type { SceneEffectEditorImageResource } from "@/lib/scene-vfx/editor";

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

export function shouldBlockSceneEffectNavigation(args: {
  dirty: boolean;
  busy: boolean;
  currentPath: string;
  nextPath: string;
}): boolean {
  return (args.dirty || args.busy) && args.currentPath !== args.nextPath;
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
