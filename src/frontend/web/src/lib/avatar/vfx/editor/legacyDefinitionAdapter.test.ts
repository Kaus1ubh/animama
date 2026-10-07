import { describe, expect, it } from "vitest";

import conversion from "@/lib/content/fixtures/avatar-effect-conversion.json";
import { legacyAvatarEffectDefinitionToV2 } from "./legacyDefinitionAdapter";

// TEMPORARY: deleted with the adapter in Phase 9.
describe("legacy creator definition adapter", () => {
  it.each(conversion.pairs.map((pair) => [pair.name, pair] as const))(
    "matches the backend converter for %s",
    (_name, pair) => {
      const converted = legacyAvatarEffectDefinitionToV2(pair.v1);
      expect(converted).toEqual(pair.v2);
      expect(legacyAvatarEffectDefinitionToV2(converted)).toEqual(converted);
    },
  );

  it("refuses settings /2 cannot express", () => {
    expect(() =>
      legacyAvatarEffectDefinitionToV2({
        ...conversion.pairs[0]!.v1,
        transform: { scale: { x: 0, y: 1, z: 1 } },
      }),
    ).toThrow(/scale/);
  });
});
