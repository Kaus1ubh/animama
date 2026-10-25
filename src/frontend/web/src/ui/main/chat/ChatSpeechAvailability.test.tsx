import type { ReactNode } from "react";
import { getI18n } from "react-i18next";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatInterfaceView } from "@/ui/main/chat/ChatInterface";

const fixture = vi.hoisted(() => ({
  capabilities: {} as Record<string, unknown>,
}));

vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: fixture.capabilities }),
}));
vi.mock("@/query/hooks/useAnima", () => ({ useAnima: () => ({}) }));
vi.mock("@/query/hooks/useModelProviders", () => ({
  useModelProviders: () => ({}),
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => ({}),
}));
// Neither offline speech nor browser speech recognition is available.
vi.mock("@/lib/speech/stt-provider", () => ({
  isWebSpeechSupported: () => false,
}));
vi.mock("@/lib/speech/composer-speech-engines", () => ({
  composerSpeechEngines: () => ({ dictation: null, voiceMode: null }),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({ effectivePreferences: {} }),
}));
vi.mock("@animama/product-ui/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@animama/product-ui/components")>()),
  ChatConversation: () => null,
}));
vi.mock("@/ui/components/chat-transcript", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    ChatTranscript: Pass,
    ChatTranscriptContent: Pass,
    ChatTranscriptScrollButton: () => null,
  };
});
vi.mock("@/ui/components/chat-input", () => ({
  ChatInput: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ChatInputDictation: () => null,
  ChatInputFileUploadButton: () => null,
  ChatInputFileUploadUnavailable: () => null,
  ChatInputModelSelector: () => null,
  ChatInputSubmit: () => null,
  ChatInputTextArea: () => null,
}));
vi.mock("@/ui/settings/OfflineSpeechDownloads", () => ({
  OfflineSpeechDownloads: ({ routedOnly }: { routedOnly?: boolean }) => (
    <div>Speech model state{routedOnly ? " (routed)" : ""}</div>
  ),
}));

function render() {
  return renderToStaticMarkup(
    <ChatInterfaceView
      animaId="annie"
      animaName="Annie"
      activeChat={null}
      activeMode={null}
      canChat
      displayMessages={[]}
      input=""
      inputPlaceholder="Message"
      isAwaitingStreamingAnimationFinalization={false}
      isStreaming={false}
      onIncompatibleModelSelect={vi.fn()}
      onInputChange={vi.fn()}
      onPromptSuggestionSelect={vi.fn()}
      onStop={vi.fn()}
      onStreamingAnimationComplete={vi.fn()}
      onSubmit={vi.fn()}
      promptSuggestions={[]}
      showPromptSuggestions={false}
      layout="chat-only"
    />,
  );
}

describe("unavailable speech recognition in the composer", () => {
  beforeEach(() => {
    fixture.capabilities = {};
  });
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("offers the offline speech download where the owner administers models", () => {
    fixture.capabilities = {
      offline_speech_enabled: false,
      local_filesystem_administration: true,
    };
    const html = render();
    expect(html).toContain(
      "Install offline speech recognition to use dictation and Voice Mode",
    );
    expect(html).toContain("Speech model state (routed)");
  });

  it("follows the UI Locale's offline engine", async () => {
    fixture.capabilities = {
      offline_speech_enabled: true,
      offline_multilingual_speech_enabled: false,
      local_filesystem_administration: true,
    };
    expect(render()).not.toContain("Speech model state");
    await getI18n().changeLanguage("ja");
    expect(render()).toContain("Speech model state (routed)");
    fixture.capabilities.offline_multilingual_speech_enabled = true;
    expect(render()).not.toContain("Speech model state");
  });

  it("says offline speech is not available where the operator provides models", () => {
    fixture.capabilities = {
      offline_speech_enabled: false,
      local_filesystem_administration: false,
    };
    const html = render();
    expect(html).not.toMatch(/Install offline speech/i);
    expect(html).toContain(
      "Offline speech recognition for dictation and Voice Mode is not available here",
    );
    expect(html).toContain("Speech model state");
  });
});
