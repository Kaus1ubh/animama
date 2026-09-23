import { describe, expect, it } from "vitest";
import { particleVFXValidationMessages } from "./particleVFXValidationMessages";

describe("particle header validation", () => {
  it("keeps identical errors on different emitters distinguishable", () => {
    const messages = particleVFXValidationMessages(
      ["emitter:Head sparks", "object.children.1"].map((target) => ({
        target,
        severity: "error" as const,
        code: "invalid-emitter-anchor" as const,
        message: "Choose a supported emitter anchor or Inherit.",
      })),
      [{ path: "object.children.1", name: "Hand sparks" }],
    );
    expect(new Set(messages).size).toBe(2);
    expect(messages[0]).toBe(
      "Head sparks: Choose a supported emitter anchor or Inherit.",
    );
    expect(messages[1]).toBe(
      "Hand sparks: Choose a supported emitter anchor or Inherit.",
    );
  });
});
