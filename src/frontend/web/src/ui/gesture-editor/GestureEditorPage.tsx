import { ActionEditorPage } from "@/ui/action-editor/ActionEditorPage";
import type { ActionComponentType } from "@/query/hooks/useEffects";

export function GestureEditorPage({
  gestureId,
  initialComponent,
  initialComponentType,
}: {
  gestureId?: string;
  initialComponent?: string;
  initialComponentType?: ActionComponentType;
}) {
  return (
    <ActionEditorPage
      key={gestureId ?? "new"}
      intent="gesture"
      itemId={gestureId}
      initialComponent={initialComponent}
      initialComponentType={initialComponentType}
    />
  );
}
