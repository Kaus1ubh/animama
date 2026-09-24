/** Product labels shared by the picker and immutable package reviews. */
export function sharingKindLabel(kind: string): string {
  return (
    (
      {
        avatar: "Avatar",
        gesture: "Gesture",
        reaction: "Reaction",
        pose: "Pose",
        idle_style: "Idle Style",
        particle_effect: "Particle Effect",
        avatar_effect: "Avatar Effect",
        scene_effect: "Scene Effect",
        sound_effect: "Sound Effect",
        appearance: "Image",
      } as Record<string, string>
    )[kind] ?? "Content"
  );
}

export function sharingSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export type PackageDisplayItem = {
  id: string;
  name: string;
  kind: string;
  selected?: boolean;
  originalName?: string;
};

/** A drop supplies one package to the same file flow used by the chooser. */
export function sharingDropSelection(files: ArrayLike<File>): {
  file: File | null;
  error: string | null;
} {
  if (files.length > 1)
    return { file: null, error: "Choose one .zip file at a time" };
  return { file: files[0] ?? null, error: null };
}
