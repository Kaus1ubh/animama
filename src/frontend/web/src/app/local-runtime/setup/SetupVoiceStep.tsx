import { useId, useMemo, type Ref } from "react";

import type { SetupTtsProvider } from "@/app/local-runtime/setup-draft";
import { getTtsProviderOptions } from "@/lib/speech/tts-provider";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  underlineTabClassName,
} from "@/ui/components/tabs";
import {
  DesktopCredentialsPanel,
  type DesktopCredentialsController,
} from "@/ui/settings/DesktopCredentialsPanel";

import { ModelSourceLink } from "./ModelSourceLink";
import { SetupSpeechDownloads } from "./SetupSpeechDownloads";
import { setupTtsOptions } from "./setup-state";

/**
 * Setup's Voice step: Speech-to-Text downloads (they install in place and
 * keep running after setup) and the default Text-to-Speech provider, each as
 * tabs. Text-to-Speech is on by default; the ElevenLabs tab takes its key on
 * desktop. The provider is saved at Finish.
 */
export function SetupVoiceStep({
  provider,
  onProviderChange,
  credentialsController,
  onKeyPendingChange,
  onKeyBusyChange,
}: {
  provider: SetupTtsProvider;
  onProviderChange: (provider: SetupTtsProvider) => void;
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

  return (
    <div className="space-y-8">
      <section aria-labelledby={`${id}-stt`} className="space-y-3">
        <h2 id={`${id}-stt`} className="text-base font-semibold">
          Speech-to-Text
        </h2>
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">
            NVIDIA&apos;s Parakeet TDT 0.6B v2 transcribes English speech on
            this device, so your voice never leaves it.
          </p>
          <ModelSourceLink
            href="https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2"
            label="Hugging Face"
          />
        </div>
        <SetupSpeechDownloads />
      </section>
      <section aria-labelledby={`${id}-tts`} className="space-y-3">
        <h2 id={`${id}-tts`} className="text-base font-semibold">
          Text-to-Speech
        </h2>
        <Tabs
          value={provider}
          onValueChange={(value) => onProviderChange(value as SetupTtsProvider)}
        >
          <TabsList
            variant="underline"
            aria-label="Text-to-Speech provider"
            className="w-fit max-w-full"
          >
            {options.map((option) => (
              <TabsTrigger
                key={option.id}
                value={option.id}
                variant="underline"
                className={underlineTabClassName(provider === option.id)}
              >
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* Both panels stay mounted, so a typed key survives a tab switch. */}
          {options.map((option) => (
            <TabsContent
              key={option.id}
              value={option.id}
              forceMount
              className="mt-4 space-y-3 data-[state=inactive]:hidden"
            >
              <div className="space-y-1">
                <p className="text-muted-foreground text-sm">
                  {option.description}
                </p>
                {option.id === "pocket_tts" ? (
                  <ModelSourceLink
                    href="https://github.com/kyutai-labs/pocket-tts"
                    label="GitHub"
                  />
                ) : null}
              </div>
              {option.disabled && option.reason ? (
                <p className="text-warning text-sm">{option.reason}</p>
              ) : null}
              {option.id === "elevenlabs" ? (
                <DesktopCredentialsPanel
                  providers={["elevenlabs"]}
                  showTitle={false}
                  description="Encrypted on this computer and never shown again."
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
