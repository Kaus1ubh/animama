import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFirstChatSuggestions } from "./useFirstChatSuggestions";

const fixture = vi.hoisted(() => ({
  chats: [] as { id: string; last_message_at: string | null }[],
  historyReady: true,
  settingsReady: true,
  hasSent: false,
}));

vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@/query/hooks/useChats", () => ({
  useChats: () => ({ data: fixture.chats, isSuccess: fixture.historyReady }),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({
    userSettings: fixture.settingsReady ? {} : null,
    userPreferences: { has_sent_chat_message: fixture.hasSent },
    updateUserPreferences: vi.fn(),
  }),
}));

function Suggestions({ messages }: { messages: { role: string }[] }) {
  return useFirstChatSuggestions(messages) ? <p>Simple greeting</p> : null;
}

function showsSuggestions(messages: { role: string }[] = []) {
  return renderToStaticMarkup(<Suggestions messages={messages} />).includes(
    "Simple greeting",
  );
}

describe("owner-wide first-message suggestions", () => {
  beforeEach(() => {
    fixture.chats = [];
    fixture.historyReady = true;
    fixture.settingsReady = true;
    fixture.hasSent = false;
  });

  it("offers suggestions to a new owner, including empty created chats", () => {
    fixture.chats = [{ id: "empty-chat", last_message_at: null }];
    expect(showsSuggestions()).toBe(true);
  });

  it("waits for history and settings before showing introductory prompts", () => {
    fixture.historyReady = false;
    expect(showsSuggestions()).toBe(false);
    fixture.historyReady = true;
    fixture.settingsReady = false;
    expect(showsSuggestions()).toBe(false);
  });

  it("hides in a new empty chat when another chat has messages", () => {
    fixture.chats = [
      { id: "another-anima-chat", last_message_at: "2026-09-23T12:00:00Z" },
    ];
    expect(showsSuggestions()).toBe(false);
  });

  it("hides as soon as an optimistic user message appears", () => {
    expect(showsSuggestions([{ role: "user" }])).toBe(false);
  });

  it("keeps suggestions hidden when previously used chats have been deleted", () => {
    fixture.hasSent = true;
    expect(showsSuggestions()).toBe(false);
  });
});
