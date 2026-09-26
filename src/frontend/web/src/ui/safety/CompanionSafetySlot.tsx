import { useCompanionSafety } from "./CompanionSafetyProvider";
import { CompanionSafetyView } from "./CompanionSafetyView";

/** Connected safety surface for the main window (below the chat input, or bottom-center). */
export function CompanionSafetySlot({ className }: { className?: string }) {
  const safety = useCompanionSafety();
  if (!safety) return null;
  return (
    <CompanionSafetyView
      notice={safety.notice}
      noticeVisible={safety.noticeVisible}
      crisis={safety.crisis}
      onDismissCrisis={safety.dismissCrisis}
      className={className}
    />
  );
}
