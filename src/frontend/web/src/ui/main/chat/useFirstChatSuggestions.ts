import { useEffect, useRef } from "react";

import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { useChats } from "@/query/hooks/useChats";
import { useSettings } from "@/ui/settings/SettingsProvider";

/** First-message suggestions belong to the installation owner, not an individual chat. */
export function useFirstChatSuggestions(
  messages: readonly { role: string }[],
): boolean {
  const ownerId = useRuntimeOwnerId();
  const chats = useChats();
  const { userSettings, userPreferences, updateUserPreferences } =
    useSettings();
  const attemptedOwnerRef = useRef<string | null>(null);
  const alreadySent =
    userPreferences?.has_sent_chat_message === true ||
    Boolean(chats.data?.some((chat) => chat.last_message_at)) ||
    messages.some((message) => message.role === "user");

  useEffect(() => {
    if (
      !ownerId ||
      !userSettings ||
      !alreadySent ||
      userPreferences?.has_sent_chat_message === true ||
      attemptedOwnerRef.current === ownerId
    )
      return;
    attemptedOwnerRef.current = ownerId;
    // Persist even when history is later deleted. SettingsProvider logs failures;
    // a later mount retries, while loaded history still suppresses suggestions.
    void updateUserPreferences({ has_sent_chat_message: true }).catch(() => {});
  }, [
    alreadySent,
    ownerId,
    updateUserPreferences,
    userPreferences,
    userSettings,
  ]);

  // Do not flash introductory prompts while existing owner history is loading.
  return Boolean(userSettings) && chats.isSuccess && !alreadySent;
}
