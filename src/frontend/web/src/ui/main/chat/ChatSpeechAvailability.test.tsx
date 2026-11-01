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
  ChatInput: ({
    actions,
    children,
  }: {
    actions?: ReactNode;
    children?: ReactNode;
  }) => (
    <>
      {actions}
      {children}
    </>
  ),
  ChatInputDictation: ({ disabled }: { disabled?: boolean }) => (
    <div>{disabled ? "Dictation disabled" : "Dictation enabled"}</div>
  ),
  ChatInputFileUploadButton: () => null,
  ChatInputFileUploadUnavailable: () => null,
  ChatInputModelSelector: () => null,
  ChatInputSubmit: () => null,
  ChatInputTextArea: () => null,
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

describe("speech recognition availability in the composer", () => {
  beforeEach(() => {
    fixture.capabilities = {};
  });
  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("disables dictation without an install prompt when speech is unavailable", () => {
    fixture.capabilities = {
      offline_speech_enabled: false,
      local_filesystem_administration: true,
    };
    const html = render();
    expect(html).toContain("Dictation disabled");
    expect(html).not.toMatch(/offline speech recognition/i);
  });

  it("follows the UI Locale's offline engine", async () => {
    fixture.capabilities = {
      offline_speech_enabled: true,
      offline_multilingual_speech_enabled: false,
      local_filesystem_administration: true,
    };
    expect(render()).toContain("Dictation enabled");
    await getI18n().changeLanguage("ja");
    expect(render()).toContain("Dictation disabled");
    fixture.capabilities.offline_multilingual_speech_enabled = true;
    expect(render()).toContain("Dictation enabled");
  });
});
