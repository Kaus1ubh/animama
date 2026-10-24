import { useId, useMemo, type ComponentProps, type Ref } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { SetupTtsProvider } from "@/app/local-runtime/setup-draft";
import { getTtsProviderOptions } from "@/lib/speech/tts-provider";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { Tabs, TabsContent } from "@/ui/components/tabs";
import { ChoiceTabsList } from "@/ui/settings/choice-tabs/ChoiceTabsList";
import {
  DesktopCredentialsPanel,
  type DesktopCredentialsController,
} from "@/ui/settings/DesktopCredentialsPanel";
import { SpeechLanguageNotice } from "@/ui/settings/SpeechLanguageNotice";

import { ModelLink } from "./ModelLink";
import { SetupSpeechChoice } from "./SetupSpeechChoice";
import { setupTtsOptions } from "./setup-state";

/** Kyutai's public Pocket TTS repository, linked from the built-in voices tab. */
const POCKET_TTS_SOURCE = "https://github.com/kyutai-labs/pocket-tts";

/**
 * Setup's Voice step: the Speech-to-Text choice (offline models, whose
 * downloads install in place and keep running after setup, and on the web the
 * browser recognizers) and the default Text-to-Speech provider, each as tabs.
 * Text-to-Speech is on by default; the ElevenLabs tab takes its key on
 * desktop. Both choices are saved at Finish.
 */
export function SetupVoiceStep({
  stt,
  provider,
  onProviderChange,
  credentialsController,
  onKeyPendingChange,
  onKeyBusyChange,
}: {
  stt: ComponentProps<typeof SetupSpeechChoice>;
  provider: SetupTtsProvider;
  onProviderChange: (provider: SetupTtsProvider) => void;
  credentialsController: Ref<DesktopCredentialsController>;
  onKeyPendingChange: (count: number) => void;
  onKeyBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation("setup");
  const id = useId();
  const platform = useRuntimePlatform();
  const options = useMemo(
    () => setupTtsOptions(getTtsProviderOptions(platform), t),
    [platform, t],
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby={`${id}-stt`} className="space-y-3">
        <h2 id={`${id}-stt`} className="text-base font-semibold">
          {t("voice.stt.heading")}
        </h2>
        <SetupSpeechChoice {...stt} />
      </section>
      <section aria-labelledby={`${id}-tts`} className="space-y-3">
        <h2 id={`${id}-tts`} className="text-base font-semibold">
          {t("voice.tts.heading")}
        </h2>
        <Tabs
          value={provider}
          onValueChange={(value) => onProviderChange(value as SetupTtsProvider)}
        >
          <ChoiceTabsList
            tabs={options.map((option) => ({
              id: option.id,
              label: option.label,
              // A provider this device cannot run is not offered.
              disabled: option.disabled,
              reason: option.reason,
            }))}
            active={provider}
            label={t("voice.tts.providers")}
          />
          {/* A disabled tab cannot take focus, so its reason is shown here. */}
          {options
            .filter((option) => option.disabled && option.reason)
            .map((option) => (
              <p key={option.id} className="text-muted-foreground mt-2 text-xs">
                {t("voice.tts.unavailableReason", {
                  provider: option.label,
                  reason: option.reason ?? "",
                })}
              </p>
            ))}
          {/* Both panels stay mounted, so a typed key survives a tab switch. */}
          {options.map((option) => (
            <TabsContent
              key={option.id}
              value={option.id}
              forceMount
              className="mt-4 space-y-3 data-[state=inactive]:hidden"
            >
              <p className="text-muted-foreground text-sm">
                {option.id === "pocket_tts" ? (
                  <Trans
                    t={t}
                    i18nKey="voice.tts.pocket.description"
                    components={{
                      link: <ModelLink href={POCKET_TTS_SOURCE} />,
                    }}
                  />
                ) : (
                  t("voice.tts.elevenLabs.description")
                )}
              </p>
              <SpeechLanguageNotice
                direction="textToSpeech"
                provider={option.id}
              />
              {option.id === "elevenlabs" ? (
                <DesktopCredentialsPanel
                  providers={["elevenlabs"]}
                  showTitle={false}
                  description={t("keys.storedDescription")}
                  className="bg-transparent p-3"
                  controllerRef={credentialsController}
                  onPendingChange={onKeyPendingChange}
                  onBusyChange={onKeyBusyChange}
                />
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </div>
  );
}
