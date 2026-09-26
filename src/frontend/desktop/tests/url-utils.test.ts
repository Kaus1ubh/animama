import { describe, expect, it } from "vitest";

import { isPhoneOrSmsUrl } from "../src/main-process/utils/url-utils.js";

describe("crisis-card dial links", () => {
  it("accepts tel and sms URLs made only of digits", () => {
    expect(isPhoneOrSmsUrl("tel:988")).toBe(true);
    expect(isPhoneOrSmsUrl("sms:0477131114")).toBe(true);
    expect(isPhoneOrSmsUrl("tel:+44116123")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [
      "tel:988?body=x",
      "tel:988;ext=1",
      "sms:988,hello",
      "tel:",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://127.0.0.1/tel:988",
      "mailto:help@example.com",
    ]) {
      expect(isPhoneOrSmsUrl(value)).toBe(false);
    }
  });
});
