import { describe, expect, it } from "vitest";
import { createActionDocument } from "@/ui/action-editor/actionDocument";
import { actionDescriptorFor } from "./useActionEditorActions";

describe("reaction sidecar placement", () => {
  it("omits placement when no suggestion is chosen or when it is cleared", () => {
    const document = createActionDocument("reaction");
    expect(
      actionDescriptorFor(document, "local:reaction:test").descriptor,
    ).not.toHaveProperty("placement_hint");
    document.suggestedEmotion = "joy";
    document.suggestedIntensity = 3;
    expect(
      actionDescriptorFor(document, "local:reaction:test").descriptor,
    ).toHaveProperty("placement_hint", { emotion: "joy", intensity: 3 });
    document.suggestedEmotion = "";
    expect(
      actionDescriptorFor(document, "local:reaction:test").descriptor,
    ).not.toHaveProperty("placement_hint");
  });
});
