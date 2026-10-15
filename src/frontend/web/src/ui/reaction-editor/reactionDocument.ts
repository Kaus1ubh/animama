import type { EmotionReactionIntensity } from "@/lib/avatar/reactionPools";
import {
  createActionDocument,
  type ActionDocument,
} from "@/ui/action-editor/actionDocument";

export function createReactionDocument(
  emotion = "",
  intensity: EmotionReactionIntensity = 1,
): ActionDocument {
  return {
    ...createActionDocument("reaction"),
    suggestedEmotion: emotion,
    suggestedIntensity: intensity,
  };
}
