import type { PyAnimaIdleStyle } from "@animama/runtime-contracts/api-types";
import { TRACKED_EMOTIONS } from "@/lib/emotion";

export type IdleStyleAssignment = {
  key: "default" | string;
  label: string;
  animationIds: string[];
  animationNames: string[];
  fallsBackToDefault: boolean;
};

/** Convert entry-local animation IDs into the friendly mapping shown in Loadout. */
export function presentIdleStyle(
  style: PyAnimaIdleStyle,
): IdleStyleAssignment[] {
  if (style.state === "empty") return [];
  const names = new Map(
    (style.animations ?? []).map((animation) => [
      animation.animation_id,
      animation.name,
    ]),
  );
  const defaultPool = style.effective_default_pool ?? [];
  const defaultNames = defaultPool.map((id) => names.get(id) ?? id);
  return [
    {
      key: "default",
      label: "Default",
      animationIds: defaultPool,
      animationNames: defaultNames,
      fallsBackToDefault: false,
    },
    ...[...TRACKED_EMOTIONS]
      .sort((left, right) => left.localeCompare(right))
      .map((emotion) => {
        const explicit = style.effective_emotion_pools?.[emotion];
        return {
          key: emotion,
          label: emotion[0]!.toUpperCase() + emotion.slice(1),
          animationIds: explicit ?? defaultPool,
          animationNames: (explicit ?? defaultPool).map(
            (id) => names.get(id) ?? id,
          ),
          fallsBackToDefault: !explicit,
        };
      }),
  ];
}
