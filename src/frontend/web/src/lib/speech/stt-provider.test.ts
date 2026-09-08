import { describe, expect, it } from "vitest";
import {
  getSttProviderOptions,
  isSttProviderSupported,
  resolvePreferredSttProvider,
} from "./stt-provider";
import type { RuntimePlatform } from "@/platform/runtime-platform";

const desktop = { kind: "desktop", isDesktop: true } as RuntimePlatform;

describe("optional offline speech capability", () => {
  it("does not treat absent or unknown Parakeet as supported", () => {
    for (const available of [false, null]) {
      expect(isSttProviderSupported("parakeet", desktop, available)).toBe(
        false,
      );
      expect(getSttProviderOptions(available, desktop)).toMatchObject([
        { id: "parakeet", disabled: true },
      ]);
      expect(
        resolvePreferredSttProvider({
          platform: desktop,
          parakeetAvailable: available,
        }).parakeetAvailable,
      ).toBe(available);
    }
  });
  it("resolves an installed Parakeet without offering unsupported browser providers", () => {
    expect(
      resolvePreferredSttProvider({
        platform: desktop,
        savedProvider: "parakeet",
        parakeetAvailable: true,
      }),
    ).toEqual({
      provider: "parakeet",
      hasExplicitPreference: true,
      parakeetAvailable: true,
    });
    expect(getSttProviderOptions(true, desktop)).toMatchObject([
      { id: "parakeet", disabled: false },
    ]);
  });
});
