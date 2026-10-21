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
          label: "Offline (CPU)",
          disabled: baseOptions[0].disabled,
          reason: baseOptions[0].reason,
        },
        {
          id: "parakeet_webgpu",
          label: "Offline (WebGPU · Experimental)",
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
    expect(baseOptions[0].label).toBe("Offline (CPU)");
  });

  it("names the UI Locale's engine and leaves its missing set to the language notice", () => {
    const [english] = getSttProviderOptions(false, desktop, "parakeet");
    expect(english.description).toContain("Parakeet TDT 0.6B v2 by NVIDIA");
    expect(english.reason).toMatch(/Install offline speech recognition/);
    const [multilingual] = getSttProviderOptions(false, desktop, "sensevoice");
    expect(multilingual.description).toContain("SenseVoice-Small by Alibaba");
    expect(multilingual).toMatchObject({ disabled: true, reason: undefined });
  });

  it("names the engine's model on the WebGPU choice too", () => {
    const [, webgpu] = getSttSettingsOptions(
      getSttProviderOptions(true, desktop, "sensevoice"),
      "sensevoice",
    );
    expect(webgpu.description).toContain("SenseVoice-Small by Alibaba");
  });
});
