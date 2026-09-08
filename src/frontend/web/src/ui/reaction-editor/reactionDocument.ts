import {
  createActionDocument,
  type ActionDocument,
} from "@/ui/action-editor/actionDocument";

export function createReactionDocument(
  emotion = "joy",
  intensity: 1 | 2 | 3 = 1,
): ActionDocument {
  return {
    ...createActionDocument("reaction"),
    suggestedEmotion: emotion,
    suggestedIntensity: intensity,
  };
}
