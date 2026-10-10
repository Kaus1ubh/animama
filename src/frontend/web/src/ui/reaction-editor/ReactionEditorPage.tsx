import { ActionEditorGate } from "@/ui/action-editor/ActionEditorGate";
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
    <ActionEditorGate intent="reaction" itemId={reactionId}>
      <ActionEditorPage
        key={reactionId ?? "new"}
        intent="reaction"
        itemId={reactionId}
        initialComponent={initialComponent}
        initialComponentType={initialComponentType}
      />
    </ActionEditorGate>
  );
}
