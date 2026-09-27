import { toast } from "sonner";

import { getAnimaDisplayName } from "@/lib/anima-profile";
import { chatModelSendGate } from "@/lib/chat/model-provider-compatibility";
import {
  readDefaultAnimaId,
  readDefaultChatModelId,
} from "@/lib/settings/preferences";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useModelProviders } from "@/query/hooks/useModelProviders";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import {
  modelOptionLabel,
  selectableChatModels,
} from "@/lib/chat/model-catalog";
import { useSettings } from "@/ui/settings/SettingsProvider";

const LAST_OPENED = "__last_opened__";
const SYSTEM_DEFAULT = "__system_default__";
const SELECT_TRIGGER_CLASS_NAME = "w-56";

/**
 * Which Anima opens at startup: "Last opened" (the default) or a pinned Anima.
 * A pinned Anima that was deleted falls back to last opened, and the row says so.
 */
export function DefaultAnimaSetting({ disabled }: { disabled: boolean }) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const animas = useAnimas();
  const pinnedId = readDefaultAnimaId(userPreferences);
  const owned = animas.data ?? [];
  const pinnedMissing =
    Boolean(pinnedId) &&
    animas.isSuccess &&
    !owned.some((anima) => anima.id === pinnedId);

  return (
    <SettingsRow
      label="Default Anima"
      description={
        pinnedMissing
          ? "The pinned Anima no longer exists; the last opened Anima is used."
          : "The Anima the app opens at startup."
      }
      control={
        <Select
          value={pinnedId && !pinnedMissing ? pinnedId : LAST_OPENED}
          disabled={disabled || !animas.isSuccess}
          onValueChange={(value) => {
            const next = value === LAST_OPENED ? null : value;
            void updateUserPreferences({
              startup: { default_anima_id: next },
            }).catch(() => toast.error("Failed to update the default Anima."));
          }}
        >
          <SelectTrigger
            className={SELECT_TRIGGER_CLASS_NAME}
            aria-label="Default Anima"
          >
            <SelectValue placeholder="Last opened" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LAST_OPENED}>Last opened</SelectItem>
            {owned.map((anima) => (
              <SelectItem key={anima.id} value={anima.id}>
                {getAnimaDisplayName(anima)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/**
 * The chat model newly created Animas start with. Existing Animas keep their
 * own model; an unavailable choice falls back to the system default on the
 * server when an Anima is created.
 */
export function DefaultChatModelSetting({ disabled }: { disabled: boolean }) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const modelProviders = useModelProviders();
  const savedId = readDefaultChatModelId(userPreferences);
  // The same chat models the server accepts as a default: supported by direct
  // chat, streaming, and (for owner models) with a context window. A hidden
  // model stays listed while it is the saved choice, as the server keeps it.
  const models = selectableChatModels(
    modelProviders.data ?? [],
    savedId,
  ).filter(
    (model) =>
      chatModelSendGate(null, model).ok &&
      model.supports_streaming !== false &&
      (model.source !== "owner" || model.context_window_tokens != null),
  );
  const savedMissing =
    Boolean(savedId) &&
    modelProviders.isSuccess &&
    !models.some((model) => model.id === savedId);

  return (
    <SettingsRow
      label="Default chat model"
      description={
        savedMissing
          ? "The chosen model is unavailable; new Animas use the system default."
          : "Used by newly created Animas. Existing Animas keep their model."
      }
      control={
        <Select
          value={savedId ?? SYSTEM_DEFAULT}
          disabled={disabled || !modelProviders.isSuccess}
          onValueChange={(value) => {
            const next = value === SYSTEM_DEFAULT ? null : value;
            void updateUserPreferences({
              chat: { default_model_provider_id: next },
            }).catch(() =>
              toast.error("Failed to update the default chat model."),
            );
          }}
        >
          <SelectTrigger
            className={SELECT_TRIGGER_CLASS_NAME}
            aria-label="Default chat model"
          >
            <SelectValue placeholder="System default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
            {savedId && savedMissing ? (
              <SelectItem value={savedId} disabled>
                {savedId} (unavailable)
              </SelectItem>
            ) : null}
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {modelOptionLabel(model)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {modelProviders.isError ? (
        <p className="text-destructive text-xs">Models could not be loaded.</p>
      ) : null}
    </SettingsRow>
  );
}
