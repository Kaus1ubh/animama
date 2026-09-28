import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  appBehaviorEnabled,
  behaviorPatch,
  type BehaviorFlag,
} from "@/lib/settings/behavior-defaults";
import { writeSelectedMicrophoneId } from "@/lib/voice/microphone-preferences";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/components/dialog";
import { Switch } from "@/ui/components/switch";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";

const BEHAVIOR_COPY: Record<
  BehaviorFlag,
  { label: string; description: string }
> = {
  memory_influence: {
    label: "Memory",
    description:
      "Read saved memories during chat. Turning this off also turns memory updates off.",
  },
  memory_updates: {
    label: "Memory updates",
    description: "Save new memories during chat.",
  },
  emotion_updates: {
    label: "Emotion updates",
    description: "Update emotional state during chat.",
  },
};

export function behaviorLabel(flag: BehaviorFlag): string {
  return BEHAVIOR_COPY[flag].label;
}

/**
 * App-wide default for a memory/emotion behaviour. Animas follow it unless
 * they set their own value in Anima settings.
 */
export function AppBehaviorSetting({
  flag,
  disabled,
}: {
  flag: BehaviorFlag;
  disabled: boolean;
}) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const enabled = appBehaviorEnabled(userPreferences, flag);
  const memoryEnabled = appBehaviorEnabled(userPreferences, "memory_influence");
  const blockedByMemory = flag === "memory_updates" && !memoryEnabled;
  const { label, description } = BEHAVIOR_COPY[flag];

  return (
    <SettingsRow
      label={label}
      description={
        blockedByMemory
          ? "Turn Memory on to allow memory updates."
          : description
      }
      control={
        <Switch
          checked={enabled && !blockedByMemory}
          disabled={disabled || blockedByMemory}
          aria-label={`${label} (app default)`}
          onCheckedChange={(checked) => {
            void updateUserPreferences(
              behaviorPatch(flag, checked ? "on" : "off"),
            ).catch(() =>
              toast.error(`Failed to update ${label.toLowerCase()}.`),
            );
          }}
        />
      }
    />
  );
}

/**
 * Restore app preferences to their defaults after confirmation. Anima
 * settings, chats, memories, content, provider keys and the display name are
 * untouched; the last opened Anima and locale are kept.
 */
export function ResetAppSettingsSetting({
  onReset,
}: {
  /** Called after a successful reset, e.g. to close App Settings so every control reloads. */
  onReset?: () => void;
}) {
  const { updateUserSettings, userPreferences } = useSettings();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const reset = async () => {
    setResetting(true);
    try {
      await updateUserSettings({
        // First-message suggestion state is product history, not a setting.
        preferences: userPreferences?.has_sent_chat_message
          ? { has_sent_chat_message: true }
          : {},
        theme: "light",
      });
      // Apply locally too, so the stored-theme sync cannot mistake the reset
      // for an echo of an earlier save.
      setTheme("light");
      // The microphone choice is stored on this machine, not in preferences.
      writeSelectedMicrophoneId(null);
      setOpen(false);
      toast.success("App settings were reset.");
      onReset?.();
    } catch {
      toast.error("App settings could not be reset. Nothing was changed.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <SettingsRow
      label="Reset app settings"
      description="Restore App Settings to their defaults. Anima settings, chats, memories and provider keys are kept."
      control={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              Reset…
            </Button>
          </DialogTrigger>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Reset app settings?</DialogTitle>
              <DialogDescription>
                Theme, colours, voice, shortcuts, defaults and other App
                Settings return to their defaults. Anima settings, chats,
                memories, content, provider keys and your display name are not
                changed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={resetting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={resetting}
                onClick={() => void reset()}
              >
                {resetting ? "Resetting…" : "Reset"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    />
  );
}
