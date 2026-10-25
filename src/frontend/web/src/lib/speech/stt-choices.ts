import type { SpeechPreferences } from "@/lib/settings/preferences";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import type { SttProviderOption } from "@/lib/speech/stt-provider";

/**
 * A Speech-to-Text choice in setup and App Settings: an offline model on the
 * CPU or GPU, or (on the web only) the browser's recognizer. Offline choices
 * save the offline provider and the GPU preference; the UI Locale still
 * decides which offline model runs.
 */
export const STT_CHOICES = [
  "sensevoice_cpu",
  "sensevoice_gpu",
  "parakeet_cpu",
  "parakeet_gpu",
  "browser_external",
] as const;
export type SttChoice = (typeof STT_CHOICES)[number];

/**
 * The Speech-to-Text choices, in order: on the web the browser's recognizer
 * (when this browser has one), then the UI Locale's offline model (CPU, then
 * GPU) and the other offline model. Desktop has no browser recognizer.
 */
export function availableSttChoices(
  engine: OfflineSttEngine,
  browserOptions: readonly SttProviderOption[],
): SttChoice[] {
  const other: OfflineSttEngine =
    engine === "sensevoice" ? "parakeet" : "sensevoice";
  const browser = browserOptions.some(
    (option) => option.id === "browser_external" && !option.disabled,
  );
  return [
    ...(browser ? (["browser_external"] as const) : []),
    `${engine}_cpu`,
    `${engine}_gpu`,
    `${other}_cpu`,
    `${other}_gpu`,
  ];
}

/**
 * The recommended choice: the browser's recognizer on the web, else the UI
 * Locale's offline model on the CPU.
 */
export function recommendedSttChoice(
  engine: OfflineSttEngine,
  choices: readonly SttChoice[],
): SttChoice {
  return choices.includes("browser_external")
    ? "browser_external"
    : `${engine}_cpu`;
}

/**
 * The speech preferences a Speech-to-Text choice saves. Either offline model's
 * choice saves the offline provider and the GPU preference; the UI Locale picks
 * the model. The browser keeps the saved GPU preference.
 */
export function sttChoicePatch(
  choice: SttChoice,
): Pick<SpeechPreferences, "stt_provider" | "stt_parakeet_webgpu"> {
  if (choice === "browser_external") return { stt_provider: choice };
  return {
    stt_provider: "parakeet",
    stt_parakeet_webgpu: choice.endsWith("_gpu"),
  };
}
