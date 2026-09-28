import {
  toSttProvider,
  type SttProvider,
  type SttProviderOption,
} from "./stt-provider";

export type SttSettingsSelection = SttProvider | "parakeet_webgpu";
type SttSettingsOption = Omit<SttProviderOption, "id"> & {
  id: SttSettingsSelection;
};

/** Present the existing provider and GPU preference as one settings choice. */
export function getSttSettingsSelection(
  provider: SttProvider | null,
  preferWebgpu: boolean,
): SttSettingsSelection | undefined {
  if (provider === "parakeet" && preferWebgpu) return "parakeet_webgpu";
  return provider ?? undefined;
}

/** Both Parakeet choices require the same base offline speech capability. */
export function getSttSettingsOptions(
  options: readonly SttProviderOption[],
): SttSettingsOption[] {
  return options.flatMap<SttSettingsOption>((option) =>
    option.id === "parakeet"
      ? [
          { ...option, label: "Parakeet (CPU)" },
          {
            ...option,
            id: "parakeet_webgpu",
            label: "Parakeet (WebGPU · Experimental)",
            description:
              "Experimental local speech recognition on the GPU with live previews. Falls back to the CPU when unavailable.",
          },
        ]
      : [option],
  );
}

/** Browser choices leave the owner's saved Parakeet GPU preference intact. */
export function getSttSettingsPreference(value: string): {
  stt_provider: SttProvider;
  stt_parakeet_webgpu?: boolean;
} | null {
  if (value === "parakeet_webgpu") {
    return { stt_provider: "parakeet", stt_parakeet_webgpu: true };
  }
  const provider = toSttProvider(value);
  if (!provider) return null;
  return provider === "parakeet"
    ? { stt_provider: provider, stt_parakeet_webgpu: false }
    : { stt_provider: provider };
}
