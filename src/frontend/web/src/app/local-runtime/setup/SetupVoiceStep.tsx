import { useId, useMemo, type Ref } from "react";

import type { SetupTtsProvider } from "@/app/local-runtime/setup-draft";
import { getTtsProviderOptions } from "@/lib/speech/tts-provider";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { Label } from "@/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@/ui/components/radio-group";
import { Switch } from "@/ui/components/switch";
import {
  DesktopCredentialsPanel,
  useDesktopCredentialConfigured,
  useDesktopCredentialsAvailable,
  type DesktopCredentialsController,
} from "@/ui/settings/DesktopCredentialsPanel";
import { OfflineSpeechDownloads } from "@/ui/settings/OfflineSpeechDownloads";

import { setupTtsOptions, type SetupTtsChoice } from "./setup-state";

/**
 * Setup's Voice step: offline speech recognition downloads (they install in
 * place and keep running after setup) and Text-to-Speech: on or off, the
 * default provider and, on desktop, the ElevenLabs key. Choices are saved at
 * Finish.
 */
export function SetupVoiceStep({
  tts,
  onTtsChange,
  credentialsController,
  onKeyPendingChange,
  onKeyBusyChange,
}: {
  tts: SetupTtsChoice;
  onTtsChange: (change: {
    enabled?: boolean;
    provider?: SetupTtsProvider;
  }) => void;
  credentialsController: Ref<DesktopCredentialsController>;
  onKeyPendingChange: (count: number) => void;
  onKeyBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const platform = useRuntimePlatform();
  const options = useMemo(
    () => setupTtsOptions(getTtsProviderOptions(platform)),
    [platform],
  );
  const managedKeys = useDesktopCredentialsAvailable();
  const elevenLabsConfigured = useDesktopCredentialConfigured("elevenlabs");
  const selected = options.find((option) => option.id === tts.provider);
  const elevenLabs = tts.enabled && tts.provider === "elevenlabs";

  return (
    <div className="space-y-6">
      <section aria-labelledby={`${id}-stt`} className="space-y-2">
        <h2 id={`${id}-stt`} className="text-base font-semibold">
          Speech-to-Text
        </h2>
        <p className="text-muted-foreground text-xs">
          Downloads keep going after you finish setup.
        </p>
        <OfflineSpeechDownloads />
      </section>
      <section aria-labelledby={`${id}-tts`} className="space-y-3">
        <h2 id={`${id}-tts`} className="text-base font-semibold">
          Text-to-Speech
        </h2>
        <p className="text-muted-foreground text-xs">
          Animas read their replies aloud.
        </p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${id}-tts-enabled`}>Enable Text-to-Speech</Label>
          <Switch
            id={`${id}-tts-enabled`}
            checked={tts.enabled}
            onCheckedChange={(enabled) => onTtsChange({ enabled })}
          />
        </div>
        <div className="space-y-1">
          <p id={`${id}-provider`} className="text-sm font-medium">
            Default provider
          </p>
          <RadioGroup
            aria-labelledby={`${id}-provider`}
            value={tts.provider}
            disabled={!tts.enabled}
            onValueChange={(value) =>
              onTtsChange({ provider: value as SetupTtsProvider })
            }
            className="gap-1"
          >
            {options.map((option) => (
              <div key={option.id} className="flex items-start gap-2 py-1">
                <RadioGroupItem
                  id={`${id}-${option.id}`}
                  value={option.id}
                  disabled={!tts.enabled || option.disabled}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`${id}-${option.id}`}
                  className="block font-normal"
                >
                  <span className="text-sm">{option.label}</span>
                  <span className="text-muted-foreground block text-xs">
                    {option.disabled && option.reason
                      ? option.reason
                      : option.description}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
          {!tts.enabled ? (
            <p className="text-muted-foreground text-xs">
              Enable Text-to-Speech to choose a provider.
            </p>
          ) : null}
        </div>
        {elevenLabs && elevenLabsConfigured === false ? (
          <p className="text-sm" role="status">
            ElevenLabs needs an API key. Save one below, or choose built-in
            voices.
          </p>
        ) : null}
        {elevenLabs && !managedKeys ? (
          <p className="text-muted-foreground text-xs">
            Uses the ElevenLabs key set on this server (ELEVENLABS_API_KEY).
          </p>
        ) : null}
        {selected?.disabled && tts.enabled ? (
          <p className="text-xs text-warning">
            {selected.reason}
          </p>
        ) : null}
        {/* Always shown on desktop, so a typed key survives a provider change. */}
        <DesktopCredentialsPanel
          providers={["elevenlabs"]}
          showTitle={false}
          description="Needed for ElevenLabs voices. Encrypted on this computer and never shown again."
          className="bg-transparent p-3"
          controllerRef={credentialsController}
          onPendingChange={onKeyPendingChange}
          onBusyChange={onKeyBusyChange}
        />
        <p className="text-muted-foreground text-xs">
          Choose voices for each Anima later in its Loadout.
        </p>
      </section>
    </div>
  );
}
