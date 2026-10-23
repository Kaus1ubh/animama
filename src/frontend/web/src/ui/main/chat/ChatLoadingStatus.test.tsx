import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatLoadingStatusLine,
  useChatLoadingStatus,
  type ChatLoadingStatus,
} from "@/ui/main/chat/ChatLoadingStatus";

const fixture = vi.hoisted(() => ({
  mounted: {
    playbackStatus: "preparing",
    avatarVisualStatus: "loading",
    preparationProgress: null as {
      completedMembers: number;
      totalMembers: number;
    } | null,
  },
  pocket: { ready: false, phase: "idle" },
  downloads: {} as Record<string, { status: string; progress: number | null }>,
  downloadsEnabled: [] as boolean[],
}));

vi.mock("@/ui/app/AnimaRouteProviders", () => ({
  useMountedAnimaRuntimeContent: () => fixture.mounted,
}));
vi.mock("@/hooks/use-pocket-tts-runtime", () => ({
  usePocketTtsRuntime: () => fixture.pocket,
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: ({ enabled }: { enabled: boolean }) => {
    fixture.downloadsEnabled.push(enabled);
    return { availability: (id: string) => fixture.downloads[id] ?? null };
  },
}));

const idle: ChatLoadingStatus = {
  avatar: false,
  content: null,
  textToSpeech: false,
  speechToText: false,
  voiceDownload: null,
};

function line(status: Partial<ChatLoadingStatus>, canChat = false) {
  return renderToStaticMarkup(
    <ChatLoadingStatusLine status={{ ...idle, ...status }} canChat={canChat} />,
  ).replace(/<[^>]+>/g, "");
}

function Harness({ isDictationPreparing = false }) {
  const status = useChatLoadingStatus({ isDictationPreparing });
  return <ChatLoadingStatusLine status={status} canChat />;
}

function routeLine(isDictationPreparing = false) {
  return renderToStaticMarkup(
    <Harness isDictationPreparing={isDictationPreparing} />,
  ).replace(/<[^>]+>/g, "");
}

describe("ChatLoadingStatusLine", () => {
  it("renders nothing when nothing is pending", () => {
    expect(line({}, true)).toBe("");
  });

  it("names every local item after one Loading verb", () => {
    expect(
      line({
        avatar: true,
        content: { completed: 31, total: 40 },
        textToSpeech: true,
        speechToText: true,
      }),
    ).toBe(
      "Loading avatar · animations and effects (31/40) · Text-to-Speech (PocketTTS) · Speech-to-Text (Parakeet)…",
    );
  });

  it("omits an unknown content count and says when chat is available", () => {
    expect(line({ content: { completed: 0, total: 0 } }, true)).toBe(
      "Loading animations and effects… You can chat now.",
    );
  });

  it("says Downloading only for a voice install, with size and progress", () => {
    const voiceDownload = { name: "Azelma", sizeBytes: 8 * 1024 ** 2 };
    expect(line({ voiceDownload: { ...voiceDownload, progress: 0.42 } })).toBe(
      "Downloading voice Azelma (8 MB)… 42%",
    );
    expect(
      line(
        {
          textToSpeech: true,
          voiceDownload: { ...voiceDownload, progress: null },
        },
        true,
      ),
    ).toBe(
      "Loading Text-to-Speech (PocketTTS)… Downloading voice Azelma (8 MB)… You can chat now.",
    );
  });
});

describe("useChatLoadingStatus", () => {
  beforeEach(() => {
    fixture.mounted = {
      playbackStatus: "preparing",
      avatarVisualStatus: "loading",
      preparationProgress: null,
    };
    fixture.pocket = { ready: false, phase: "idle" };
    fixture.downloads = {};
    fixture.downloadsEnabled = [];
  });

  it("shows the Avatar first, then content progress once it is visible", () => {
    expect(routeLine()).toBe("Loading avatar… You can chat now.");
    fixture.mounted = {
      playbackStatus: "preparing",
      avatarVisualStatus: "visible",
      preparationProgress: { completedMembers: 3, totalMembers: 9 },
    };
    expect(routeLine()).toBe(
      "Loading animations and effects (3/9)… You can chat now.",
    );
    fixture.mounted.playbackStatus = "ready";
    expect(routeLine()).toBe("");
  });

  it("reports PocketTTS only during its first load and Parakeet while dictation prepares", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.mounted.avatarVisualStatus = "visible";
    fixture.pocket = { ready: false, phase: "loading" };
    expect(routeLine(true)).toBe(
      "Loading Text-to-Speech (PocketTTS) · Speech-to-Text (Parakeet)… You can chat now.",
    );
    fixture.pocket = { ready: true, phase: "loading" };
    expect(routeLine()).toBe("");
  });

  it("reads a downloading voice from the shared cache without fetching", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.downloads.azelma = { status: "downloading", progress: 0.5 };
    expect(routeLine()).toMatch(/^Downloading voice Azelma \(.+\)… 50%/);
    expect(fixture.downloadsEnabled.every((enabled) => !enabled)).toBe(true);
  });
});
