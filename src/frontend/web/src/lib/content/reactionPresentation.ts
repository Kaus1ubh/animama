import type { PyReaction } from "@/lib/content/catalogTypes";

export type ReactionPresentation = {
  key: string;
  name: string;
  description: string;
  originLabel: "Built-in" | "Mine";
  versionLabel: string;
  exactSource: PyReaction["source"];
  placementLabel: string | null;
  updateAvailable: boolean;
};

function placementLabel(value: PyReaction): string | null {
  const hint = value.metadata?.placement_hint;
  if (!hint || typeof hint !== "object") return null;
  const emotion = "emotion" in hint ? String(hint.emotion) : "";
  const intensity = "intensity" in hint ? Number(hint.intensity) : 0;
  return emotion && intensity ? `${emotion} · Level ${intensity}` : null;
}

/** Build a stable Reaction card independent of its sequence implementation. */
export function presentReaction(value: PyReaction): ReactionPresentation {
  return {
    key: `${value.origin}:${value.item_id}`,
    name: value.name,
    description: value.description?.trim() || "No description",
    originLabel: value.origin === "builtin" ? "Built-in" : "Mine",
    versionLabel:
      value.source?.type === "builtin"
        ? `Built-in v${value.source.version}`
        : value.state === "ready"
          ? "Local"
          : "Needs attention",
    exactSource: value.source,
    placementLabel: placementLabel(value),
    updateAvailable: value.update_available ?? false,
  };
}
