import { describe, expect, it } from "vitest";
import type { RuntimePlatform } from "@/platform/runtime-platform";
import { getSttProviderOptions } from "./stt-provider";
import {
  getSttSettingsOptions,
  getSttSettingsPreference,
  getSttSettingsSelection,
} from "./stt-settings";

const desktop = { kind: "desktop", isDesktop: true } as RuntimePlatform;
const browser = { kind: "web", isDesktop: false } as RuntimePlatform;

describe("speech settings selection", () => {
  it("represents existing preferences without a storage migration", () => {
    expect(getSttSettingsSelection("parakeet", true)).toBe("parakeet_webgpu");
    expect(getSttSettingsSelection("parakeet", false)).toBe("parakeet");
    expect(getSttSettingsSelection("browser_external", true)).toBe(
      "browser_external",
    );
    expect(getSttSettingsSelection(null, true)).toBeUndefined();
  });

  it.each([
    ["parakeet", false],
    ["parakeet_webgpu", true],
  ] as const)(
    "round-trips the %s choice through saved preferences",
    (value, gpu) => {
      const preference = getSttSettingsPreference(value);
      expect(preference).toEqual({
        stt_provider: "parakeet",
        stt_parakeet_webgpu: gpu,
      });
      expect(
        getSttSettingsSelection(
          preference!.stt_provider,
          preference!.stt_parakeet_webgpu === true,
        ),
      ).toBe(value);
    },
  );

  it.each(["browser_external", "browser_local"] as const)(
    "preserves the saved GPU preference when selecting %s",
    (provider) => {
      const patch = getSttSettingsPreference(provider);
      expect(patch).toEqual({ stt_provider: provider });
      expect({ stt_parakeet_webgpu: true, ...patch }).toEqual({
        stt_provider: provider,
        stt_parakeet_webgpu: true,
      });
    },
  );

  it("rejects unknown choices", () => {
    expect(getSttSettingsPreference("unknown")).toBeNull();
    expect(getSttSettingsPreference("")).toBeNull();
  });
});

describe("speech settings options", () => {
  it.each([true, false, null])(
    "inherits base pack availability (%s) for both desktop Parakeet choices",
    (available) => {
      const baseOptions = getSttProviderOptions(available, desktop);
      const options = getSttSettingsOptions(baseOptions);
      expect(options).toMatchObject([
        {
          id: "parakeet",
          label: "Parakeet (CPU)",
          disabled: baseOptions[0].disabled,
          reason: baseOptions[0].reason,
        },
        {
          id: "parakeet_webgpu",
          label: "Parakeet (WebGPU · Experimental)",
          disabled: baseOptions[0].disabled,
          reason: baseOptions[0].reason,
        },
      ]);
      expect(options).toHaveLength(2);
    },
  );

  it("retains browser options and explains the GPU fallback", () => {
    const baseOptions = getSttProviderOptions(true, browser);
    const options = getSttSettingsOptions(baseOptions);
    expect(options.slice(2)).toEqual(baseOptions.slice(1));
    expect(options[1].description).toMatch(/local.*GPU/i);
    expect(options[1].description).toMatch(/live previews/i);
    expect(options[1].description).toMatch(/falls back to.*CPU/i);
    expect(baseOptions[0].label).toBe("Parakeet");
  });
});
