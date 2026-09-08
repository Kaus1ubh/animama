import { ActionEditorPage } from "@/ui/action-editor/ActionEditorPage";
import type { ActionComponentType } from "@/query/hooks/useEffects";

export function ReactionEditorPage({
  reactionId,
  initialComponent,
  initialComponentType,
}: {
  reactionId?: string;
  initialComponent?: string;
  initialComponentType?: ActionComponentType;
}) {
  return (
    <ActionEditorPage
      key={reactionId ?? "new"}
      intent="reaction"
      itemId={reactionId}
      initialComponent={initialComponent}
      initialComponentType={initialComponentType}
    />
  );
}
