import { useTranslation } from "react-i18next";

import type { SetupSttChoice } from "@/app/local-runtime/setup-draft";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import { useOfflineSpeechDownloads } from "@/ui/settings/OfflineSpeechDownloads";
import {
  OfflineSetPanel,
  type SpeechSet,
} from "@/ui/settings/speech/OfflineSetPanel";
import { SttChoiceTabs } from "@/ui/settings/speech/SttChoiceTabs";

/** An offline choice's engine and set, from its id (`sensevoice_gpu`). */
const offlineChoice = (choice: SetupSttChoice) => {
  const [engine, set] = choice.split("_") as [OfflineSttEngine, SpeechSet];
  return { engine, set };
};

/**
 * Setup's Speech-to-Text choice as two tab levels (`SttChoiceTabs`): on the
 * web the browser's recognizer (recommended there), then the UI Locale's
 * offline model (recommended on desktop) and the other one, each with CPU |
 * GPU variants. The selected choice, engine included, is saved at Finish. Offline variants
 * show their set's state and, while downloads are offered, its download, which
 * is backend-owned and keeps running after setup, so while one downloads a line
 * says setup can finish meanwhile; removal and attribution live in App
 * Settings. Vite development serves host sets instead, so it shows how to
 * acquire them.
 */
export function SetupSpeechChoice({
  choice,
  choices,
  recommended,
  onChoiceChange,
}: {
  choice: SetupSttChoice;
  choices: readonly SetupSttChoice[];
  recommended: SetupSttChoice;
  onChoiceChange: (choice: SetupSttChoice) => void;
}) {
  const { t } = useTranslation("setup");
  const downloads = {
    parakeet: useOfflineSpeechDownloads("parakeet"),
    sensevoice: useOfflineSpeechDownloads("sensevoice"),
  };
  const downloading = Object.values(downloads).some(({ cpu, gpu }) =>
    [cpu, gpu].some((asset) => asset?.status === "downloading"),
  );

  return (
    <>
      <SttChoiceTabs
        choice={choice}
        choices={choices}
        recommended={recommended}
        onChoiceChange={onChoiceChange}
        panel={(selected) => (
          <OfflineSetPanel
            {...offlineChoice(selected)}
            downloads={downloads[offlineChoice(selected).engine]}
          />
        )}
      />
      {downloading ? (
        <p className="text-muted-foreground text-xs">
          {t("voice.stt.finishWhileDownloading")}
        </p>
      ) : null}
    </>
  );
}
