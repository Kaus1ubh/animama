import {
  BUILT_IN_AVATAR_MOTION_CATALOG,
  type AvatarMotionCatalog,
} from "./motion/AvatarMotionCatalog";

export type PreloadClipSpec = {
  clipName: string;
  clipUrl: string;
};

export type AnimationPreloadPlan = {
  tierA: PreloadClipSpec[];
  tierB: PreloadClipSpec[];
};

export function buildAnimationPreloadPlan(
  catalog: AvatarMotionCatalog = BUILT_IN_AVATAR_MOTION_CATALOG,
): AnimationPreloadPlan {
  const entries = catalog.getPreloadEntries();
  const tierA = dedupeEntries(
    catalog,
    entries.filter((entry) => entry.tier === "tier_a"),
  );
  const tierAKeys = new Set(
    tierA.map((entry) => `${entry.clipName}::${entry.clipUrl}`),
  );
  const tierB = dedupeEntries(
    catalog,
    entries.filter((entry) => entry.tier === "tier_b"),
  ).filter((entry) => !tierAKeys.has(`${entry.clipName}::${entry.clipUrl}`));

  return { tierA, tierB };
}

function dedupeEntries(
  catalog: AvatarMotionCatalog,
  entries: ReturnType<AvatarMotionCatalog["getPreloadEntries"]>,
): PreloadClipSpec[] {
  const unique = new Map<string, PreloadClipSpec>();
  for (const entry of entries) {
    if (!entry.file || !entry.clipName) continue;
    const clipUrl = catalog.resolveVrma(entry.file)?.url;
    if (!clipUrl) continue;
    const clipName = entry.clipName;
    const key = `${clipName}::${clipUrl}`;
    if (!unique.has(key)) {
      unique.set(key, { clipName, clipUrl });
    }
  }
  return Array.from(unique.values());
}
