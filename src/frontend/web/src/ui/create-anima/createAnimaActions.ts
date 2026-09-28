import type { PyGesture } from "@animama/runtime-contracts/sdk";
import type { CreateAnimaDraft } from "./createAnimaDraft";

export function selectCreationGesture(
  gestures: CreateAnimaDraft["gestures"],
  item: PyGesture | null,
  semanticKey: string,
): CreateAnimaDraft["gestures"] {
  const remaining = gestures.filter(
    (gesture) => gesture.semantic_key !== semanticKey,
  );
  return item
    ? [
        ...remaining,
        {
          semantic_key: semanticKey,
          source: {
            item_id: item.item_id,
            revision_sha256: item.revision_sha256,
          },
        },
      ].sort((a, b) => a.semantic_key.localeCompare(b.semantic_key))
    : remaining;
}

/** Server Gesture indices refer to the canonical submitted order, not a filtered UI. */
export function creationIssueTarget(
  path: string,
  gestures: CreateAnimaDraft["gestures"],
): string {
  if (path.startsWith("/voice")) return "creation-voice";
  if (path.startsWith("/avatar")) return "creation-avatar";
  if (path.startsWith("/display_name")) return "creation-display-name";
  if (path.startsWith("/identity_markdown")) return "creation-identity";
  const gesture = /^\/gestures\/(\d+)/.exec(path);
  if (gesture) {
    const key = [...gestures].sort((a, b) =>
      a.semantic_key.localeCompare(b.semantic_key),
    )[Number(gesture[1])]?.semantic_key;
    return key ? `creation-gesture-${key}` : "creation-gestures";
  }
  const cell = /^\/reactions\/([a-z_]+)\/([123])/.exec(path);
  return cell ? `creation-reaction-${cell[1]}-${cell[2]}` : "creation-actions";
}
