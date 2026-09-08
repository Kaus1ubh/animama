import type { PyGesture } from "@/lib/content/catalogTypes";

export type GesturePresentation = {
  key: string;
  name: string;
  description: string;
  semanticKey: string;
  originLabel: "Built-in" | "Mine";
  versionLabel: string;
  exactSource: PyGesture["source"];
  updateAvailable: boolean;
};

/** Build a stable product card without exposing storage or file terminology. */
export function presentGesture(value: PyGesture): GesturePresentation {
  return {
    key: `${value.origin}:${value.item_id}`,
    name: value.name,
    description: value.description?.trim() || "No description",
    semanticKey: value.semantic_key ?? value.logical_key ?? value.item_id,
    originLabel: value.origin === "builtin" ? "Built-in" : "Mine",
    versionLabel:
      value.source?.type === "builtin"
        ? `Built-in v${value.source.version}`
        : value.state === "ready"
          ? "Local"
          : "Needs attention",
    exactSource: value.source,
    updateAvailable: value.update_available ?? false,
  };
}
