import { describe, expect, it } from "vitest";

import { canPublishNumberInput } from "./number-input-draft";

describe("native number editing", () => {
  it("holds empty and incomplete native edits without publishing zero or NaN", () => {
    expect(
      canPublishNumberInput({
        value: "",
        valueAsNumber: NaN,
        validity: { badInput: false },
      }),
    ).toBe(false);
    // Browsers expose a lone minus, decimal point or incomplete exponent as
    // an empty value with badInput, while retaining the visible editing buffer.
    expect(
      canPublishNumberInput({
        value: "",
        valueAsNumber: NaN,
        validity: { badInput: true },
      }),
    ).toBe(false);
  });

  it("publishes finite values without imposing new bounds or step rounding", () => {
    for (const value of ["0", "-0.25", "1.125", "1e3"]) {
      expect(
        canPublishNumberInput({
          value,
          valueAsNumber: Number(value),
          validity: { badInput: false },
        }),
      ).toBe(true);
    }
    expect(
      canPublishNumberInput({
        value: "1e999",
        valueAsNumber: Infinity,
        validity: { badInput: true },
      }),
    ).toBe(false);
  });

  it("allows intentional clearing without treating invalid partial text as an optional empty value", () => {
    expect(
      canPublishNumberInput(
        { value: "", valueAsNumber: NaN, validity: { badInput: false } },
        true,
      ),
    ).toBe(true);
    expect(
      canPublishNumberInput(
        { value: "", valueAsNumber: NaN, validity: { badInput: true } },
        true,
      ),
    ).toBe(false);
  });
});
