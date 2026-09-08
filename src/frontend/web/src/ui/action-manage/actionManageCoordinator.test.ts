import { describe, expect, it } from "vitest";
import { failedActionTargets } from "./actionManageCoordinator";

describe("action manage coordinator", () => {
  it("retries failed targets without replaying successes", () => {
    expect(
      failedActionTargets([
        { animaId: "a", ok: true },
        { animaId: "b", ok: false },
        { animaId: "c", ok: true },
      ]),
    ).toEqual(["b"]);
  });
});
