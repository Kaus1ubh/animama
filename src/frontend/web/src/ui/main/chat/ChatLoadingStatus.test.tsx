import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatLoadingStatusLines,
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

/** The rendered status lines, in order. */
function linesOf(markup: string): string[] {
  return [...markup.matchAll(/<p>(.*?)<\/p>/g)].map((match) => match[1]);
}

function lines(status: Partial<ChatLoadingStatus>, canChat = false) {
  return linesOf(
    renderToStaticMarkup(
      <ChatLoadingStatusLines
        status={{ ...idle, ...status }}
        canChat={canChat}
      />,
    ),
  );
}

function Harness({ isDictationPreparing = false }) {
  const status = useChatLoadingStatus({ isDictationPreparing });
  return <ChatLoadingStatusLines status={status} canChat />;
}

function routeLines(isDictationPreparing = false) {
  return linesOf(
    renderToStaticMarkup(
      <Harness isDictationPreparing={isDictationPreparing} />,
    ),
  );
}

describe("ChatLoadingStatusLines", () => {
  it("renders nothing when nothing is pending", () => {
    expect(
      renderToStaticMarkup(<ChatLoadingStatusLines status={idle} canChat />),
    ).toBe("");
  });

  it("stacks one Loading line per local item", () => {
    expect(
      lines({
        avatar: true,
        content: { completed: 31, total: 40 },
        textToSpeech: true,
        speechToText: true,
      }),
    ).toEqual([
      "Loading avatar…",
      "Loading animations and effects (31/40)…",
      "Loading Text-to-Speech (PocketTTS)…",
      "Loading Speech-to-Text (Parakeet)…",
    ]);
  });

  it("omits an unknown content count and says when chat is available", () => {
    expect(lines({ content: { completed: 0, total: 0 } }, true)).toEqual([
      "Loading animations and effects…",
      "You can chat now.",
    ]);
  });

  it("says Downloading only for a voice install, with size and progress", () => {
    const voiceDownload = { name: "Azelma", sizeBytes: 8 * 1024 ** 2 };
    expect(
      lines({ voiceDownload: { ...voiceDownload, progress: 0.42 } }),
    ).toEqual(["Downloading voice Azelma (8 MB)… 42%"]);
    expect(
      lines(
        {
          textToSpeech: true,
          voiceDownload: { ...voiceDownload, progress: null },
        },
        true,
      ),
    ).toEqual([
      "Loading Text-to-Speech (PocketTTS)…",
      "Downloading voice Azelma (8 MB)…",
      "You can chat now.",
    ]);
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
    expect(routeLines()).toEqual(["Loading avatar…", "You can chat now."]);
    fixture.mounted = {
      playbackStatus: "preparing",
      avatarVisualStatus: "visible",
      preparationProgress: { completedMembers: 3, totalMembers: 9 },
    };
    expect(routeLines()).toEqual([
      "Loading animations and effects (3/9)…",
      "You can chat now.",
    ]);
    fixture.mounted.playbackStatus = "ready";
    expect(routeLines()).toEqual([]);
  });

  it("reports PocketTTS only during its first load and Parakeet while dictation prepares", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.mounted.avatarVisualStatus = "visible";
    fixture.pocket = { ready: false, phase: "loading" };
    expect(routeLines(true)).toEqual([
      "Loading Text-to-Speech (PocketTTS)…",
      "Loading Speech-to-Text (Parakeet)…",
      "You can chat now.",
    ]);
    fixture.pocket = { ready: true, phase: "loading" };
    expect(routeLines()).toEqual([]);
  });

  it("reads a downloading voice from the shared cache without fetching", () => {
    fixture.mounted.playbackStatus = "ready";
    fixture.downloads.azelma = { status: "downloading", progress: 0.5 };
    expect(routeLines()[0]).toMatch(/^Downloading voice Azelma \(.+\)… 50%$/);
    expect(fixture.downloadsEnabled.every((enabled) => !enabled)).toBe(true);
  });
});
