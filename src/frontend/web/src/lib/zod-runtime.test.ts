import "./zod-runtime";

import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("zod runtime", () => {
  it("creates and parses object schemas without evaluating strings", () => {
    const original = globalThis.Function;
    let constructed = 0;
    globalThis.Function = new Proxy(original, {
      apply(target, thisArg, args) {
        constructed++;
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args) {
        constructed++;
        return Reflect.construct(target, args);
      },
    });
    try {
      const schema = z.object({ name: z.string(), count: z.number() });
      expect(schema.parse({ name: "Annie", count: 2 })).toEqual({
        name: "Annie",
        count: 2,
      });
    } finally {
      globalThis.Function = original;
    }
    // A strict Content Security Policy reports any probe, even a caught one.
    expect(constructed).toBe(0);
  });
});
