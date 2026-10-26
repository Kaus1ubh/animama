import { describe, expect, it } from "vitest";

import { toTraditional } from "./script";

describe("toTraditional", () => {
  it("writes Simplified text in Taiwan-standard Traditional characters", async () => {
    expect(await toTraditional("说这群人着急")).toBe("說這群人著急");
    expect(await toTraditional("这个软件里的鼠标")).toBe("這個軟件裡的鼠標");
  });

  it("leaves empty text and text without Chinese unchanged", async () => {
    expect(await toTraditional("")).toBe("");
    expect(await toTraditional("Hello 2026")).toBe("Hello 2026");
  });
});
