import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { SttChoice } from "@/lib/speech/stt-choices";
import type { OfflineSttEngine } from "@/lib/speech/offline-stt/routing";
import { offlineSttShortName } from "@/lib/speech/stt-provider";
import { Tabs, TabsContent } from "@/ui/components/tabs";
import {
  ChoiceTabsList,
  VariantTabsList,
} from "@/ui/settings/choice-tabs/ChoiceTabsList";
import { OfflineEngineDownloads } from "@/ui/settings/OfflineSpeechDownloads";

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
  variantLabel,
  onChoiceChange,
  panel,
}: {
  choice: SttChoice;
  choices: readonly SttChoice[];
  recommended: SttChoice;
  /** An offline variant's label, such as "CPU (228.5 MB)"; plain CPU | GPU by default. */
  variantLabel?: (choice: SttChoice) => string;
  onChoiceChange: (choice: SttChoice) => void;
  panel: (choice: SttChoice) => ReactNode;
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
  const labelOf =
    variantLabel ??
    ((option: SttChoice) =>
      option.endsWith("_gpu")
        ? t("providers.stt.variants.gpu")
        : t("providers.stt.variants.cpu"));
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
          recommended: engine === sttChoiceEngine(recommended),
        }))}
        active={active}
        label={t("providers.stt.enginesLabel")}
        recommendedLabel={t("providers.stt.recommended")}
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
          {panel(choice)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/**
 * An offline engine's tab in App Settings: when the app uses it (if not for
 * the UI Locale) and its sets' downloads, removal and attribution.
 */
export function OfflineEngineSettingsPanel({
  engine,
  routed,
}: {
  engine: OfflineSttEngine;
  /** The engine serves the UI Locale. */
  routed: boolean;
}) {
  const { t } = useTranslation("setup");
  return (
    <div className="space-y-3">
      {routed ? null : (
        <p className="text-muted-foreground text-xs">
          {engine === "parakeet"
            ? t("voice.stt.otherLanguage.parakeet")
            : t("voice.stt.otherLanguage.sensevoice")}
        </p>
      )}
      <OfflineEngineDownloads engine={engine} />
    </div>
  );
}
