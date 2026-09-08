import {
  createActionDocument,
  gestureSemanticKey,
  type ActionDocument,
} from "@/ui/action-editor/actionDocument";

export function createGestureDocument(name = ""): ActionDocument {
  const document = createActionDocument("gesture");
  return { ...document, name, semanticKey: gestureSemanticKey(name) };
}
