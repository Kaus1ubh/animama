import { useRef, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { SttChoice } from "@/lib/speech/stt-choices";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import { offlineSttShortName } from "@/lib/speech/stt-provider";
import { ModelLink } from "@/ui/components/model-link";
import { Tabs, TabsContent } from "@/ui/components/tabs";
import {
  ChoiceTabsList,
  VariantTabsList,
} from "@/ui/settings/choice-tabs/ChoiceTabsList";
import { useFormatters } from "@animama/product-ui/i18n";
import { offlineSpeechAssetIds } from "@/lib/speech/offline-stt/asset-ids";
import { OFFLINE_SPEECH_DOWNLOADS_OFFERED } from "@/lib/speech/offline-stt/clients";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { useOfflineSpeechDownloads } from "@/ui/settings/OfflineSpeechDownloads";
import { OfflineSetPanel, type SpeechSet } from "./OfflineSetPanel";

/** Where the Web Speech API and its languages are described. */
const WEB_SPEECH_API_DOCS =
  "https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API";

/** A top-level Speech-to-Text tab: the browser or an offline engine. */
export type SttEngineTab = "browser" | OfflineSttEngine;

/** The top-level tab a choice belongs to. */
export function sttChoiceEngine(choice: SttChoice): SttEngineTab {
  return choice === "browser_external"
    ? "browser"
    : (choice.split("_")[0] as OfflineSttEngine);
}

/**
 * Speech-to-Text choices as two tab levels, like the AI step's Cloud | Local
 * and provider tabs: the engines (Browser, SenseVoice, Parakeet) with the
 * recommended one tagged, then an offline engine's CPU | GPU variants.
 * Selecting a tab selects a choice; `panel` renders the selected choice.
 */
export function SttChoiceTabs({
  choice,
  choices,
  recommended,
  onChoiceChange,
  panel,
  selected = null,
}: {
  choice: SttChoice;
  choices: readonly SttChoice[];
  recommended: SttChoice;
  onChoiceChange: (choice: SttChoice) => void;
  /** An offline choice's panel. */
  panel: (choice: SttChoice) => ReactNode;
  /** The engine in use, tagged "Selected". */
  selected?: SttEngineTab | null;
}) {
  const { t } = useTranslation("voice");
  const engines = [...new Set(choices.map(sttChoiceEngine))];
  const active = sttChoiceEngine(choice);
  // Returning to an engine reselects the variant last chosen there.
  const lastVariant = useRef(new Map<SttEngineTab, SttChoice>());
  lastVariant.current.set(active, choice);
  const engineLabel = (engine: SttEngineTab) =>
    engine === "browser"
      ? t("providers.stt.browserLabel")
      : offlineSttShortName(engine);
  const { fileSize } = useFormatters();
  const assets = useModelAssets({ enabled: true }).data?.assets;
  /** An offline variant's label, "CPU (228.5 MB)" once its size is known. */
  const labelOf = (option: SttChoice) => {
    const [engine, set] = option.split("_") as [
      OfflineSttEngine,
      "cpu" | "gpu",
    ];
    const id = offlineSpeechAssetIds[engine][set === "gpu" ? "gpu" : "base"];
    const asset = OFFLINE_SPEECH_DOWNLOADS_OFFERED
      ? assets?.find((item) => item.id === id)
      : undefined;
    if (!asset)
      return set === "gpu"
        ? t("providers.stt.variants.gpu")
        : t("providers.stt.variants.cpu");
    const size = fileSize(asset.size_bytes);
    return set === "gpu"
      ? t("providers.stt.variants.gpuWithSize", { size })
      : t("providers.stt.variants.cpuWithSize", { size });
  };
  const variants = choices.filter(
    (option) => sttChoiceEngine(option) === active,
  );

  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        const engine = value as SttEngineTab;
        onChoiceChange(
          lastVariant.current.get(engine) ??
            choices.find((option) => sttChoiceEngine(option) === engine) ??
            choice,
        );
      }}
    >
      <ChoiceTabsList
        tabs={engines.map((engine) => ({
          id: engine,
          label: engineLabel(engine),
          // The browser is the web's default, not a recommendation.
          recommended:
            engine !== "browser" && engine === sttChoiceEngine(recommended),
        }))}
        active={active}
        selected={selected ?? undefined}
        label={t("providers.stt.enginesLabel")}
        recommendedLabel={t("providers.stt.recommended")}
        selectedLabel={t("providers.selected")}
      />
      {engines.map((engine) => (
        <TabsContent key={engine} value={engine} className="mt-4 space-y-4">
          {variants.length > 1 ? (
            <Tabs
              value={choice}
              onValueChange={(value) => onChoiceChange(value as SttChoice)}
            >
              <VariantTabsList
                tabs={variants.map((option) => ({
                  id: option,
                  label: labelOf(option),
                }))}
                active={choice}
                label={t("providers.stt.variantsLabel", {
                  engine: engineLabel(engine),
                })}
              />
            </Tabs>
          ) : null}
          {choice === "browser_external" ? <BrowserSttPanel /> : panel(choice)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The browser's recognizer: the Web Speech API, in most languages. */
function BrowserSttPanel() {
  const { t } = useTranslation("voice");
  return (
    <div className="text-muted-foreground space-y-1 text-sm">
      <p>{t("providers.stt.browserExternal.description")}</p>
      <p>
        <Trans
          t={t}
          i18nKey="providers.stt.browserLanguages"
          components={{ link: <ModelLink href={WEB_SPEECH_API_DOCS} /> }}
        />
      </p>
    </div>
  );
}

/**
 * An offline engine's CPU or GPU version in App Settings: the setup panel
 * with removal, the WebGPU fallback note and operator-managed state.
 */
export function OfflineEngineSettingsPanel({
  engine,
  set,
  routed,
}: {
  engine: OfflineSttEngine;
  set: SpeechSet;
  /** The engine serves the UI Locale. */
  routed: boolean;
}) {
  return (
    <OfflineSetPanel
      engine={engine}
      set={set}
      routed={routed}
      downloads={useOfflineSpeechDownloads(engine)}
      manage
    />
  );
}
