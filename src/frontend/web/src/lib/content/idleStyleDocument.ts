import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";

export type IdleStyleAnimationDraft = {
  animationId: string;
  name: string;
  file: File;
};

export type IdleStyleDocument = {
  animations: IdleStyleAnimationDraft[];
  defaultPool: string[];
  emotionPools: Partial<Record<TrackedEmotion, string[]>>;
  crossFadeSeconds: number;
};

/** Build the immutable API spec while keeping browser File objects local. */
export function idleStyleSpec(document: IdleStyleDocument) {
  const known = new Set(document.animations.map((row) => row.animationId));
  if (!document.animations.length)
    throw new Error("Add at least one animation.");
  if (known.size !== document.animations.length)
    throw new Error("Animation IDs must be unique within a style.");
  if (document.animations.some((row) => !row.name.trim()))
    throw new Error("Every animation needs a name.");
  if (!document.defaultPool.length) throw new Error("Choose a default idle.");
  if (document.defaultPool.some((id) => !known.has(id)))
    throw new Error("The default pool contains an unknown animation.");
  const emotionPools = Object.fromEntries(
    TRACKED_EMOTIONS.flatMap((emotion) => {
      const pool = document.emotionPools[emotion];
      if (!pool?.length) return [];
      if (pool.some((id) => !known.has(id)))
        throw new Error(`${emotion} contains an unknown animation.`);
      return [[emotion, pool]];
    }),
  );
  return {
    animations: document.animations.map((row, index) => ({
      animation_id: row.animationId,
      name: row.name.trim(),
      ordinal: index + 1,
      playback: {
        loop_type: "pingpong",
        loop_count: 2,
        time_scale: 1,
        blend_mode: "override",
      },
    })),
    default_pool: document.defaultPool,
    emotion_pools: emotionPools,
    cross_fade_seconds: document.crossFadeSeconds,
    compatibility: { vrm_versions: ["0.x", "1.0"] },
  };
}

export function idleAnimationId(file: File, index: number): string {
  const normalized = file.name
    .replace(/\.vrma$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return normalized || `idle_${index + 1}`;
}
