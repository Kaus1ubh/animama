import { getI18n } from "react-i18next";

import {
  routeOfflineSpeech,
  type OfflineSttEngine,
} from "@/lib/speech/offline-stt/routing";
import {
  offlineSttModelName,
  offlineSttShortName,
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

/**
 * Both offline choices require the same base set of `engine`, the UI Locale's
 * offline engine, and both are labelled and described with its model.
 */
export function getSttSettingsOptions(
  options: readonly SttProviderOption[],
  engine: OfflineSttEngine = routeOfflineSpeech().engine,
): SttSettingsOption[] {
  const t = getI18n().getFixedT(null, "voice");
  return options.flatMap<SttSettingsOption>((option) =>
    option.id === "parakeet"
      ? [
          {
            ...option,
            label: t("providers.stt.parakeet.cpuLabel", {
              model: offlineSttShortName(engine),
            }),
          },
          {
            ...option,
            id: "parakeet_webgpu",
            label: t("providers.stt.parakeet.webgpuLabel", {
              model: offlineSttShortName(engine),
            }),
            description: t("providers.stt.parakeet.webgpuDescription", {
              model: offlineSttModelName(engine),
            }),
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
