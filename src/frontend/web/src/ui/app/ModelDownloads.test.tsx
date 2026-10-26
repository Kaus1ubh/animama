// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { ModelDownloadToasts, useModelDownloads } from "./ModelDownloads";

type Asset = {
  id: string;
  status: string;
  size_bytes: number;
  total_bytes?: number | null;
  bytes_downloaded?: number | null;
};

const fixture = vi.hoisted(() => ({
  assets: undefined as Asset[] | undefined,
  operatorManaged: false,
  enabled: [] as boolean[],
}));

vi.mock("@/query/hooks/useModelAssets", () => ({
  useOperatorManagedModelAssets: () => fixture.operatorManaged,
  useModelAssets: ({ enabled }: { enabled: boolean }) => {
    fixture.enabled.push(enabled);
    return { data: fixture.assets && { assets: fixture.assets } };
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const parakeet = (status: string, downloaded?: number): Asset => ({
  id: "parakeet-stt",
  status,
  size_bytes: 661332409,
  total_bytes: downloaded === undefined ? null : 1000,
  bytes_downloaded: downloaded ?? null,
});
const senseVoiceGpu = (status: string): Asset => ({
  id: "sensevoice-stt-webgpu",
  status,
  size_bytes: 937619109,
});
const encoder = (status: string): Asset => ({
  id: "pocket-tts-voice-cloning-encoder",
  status,
  size_bytes: 39768446,
});
const voice = (status: string): Asset => ({
  id: "pocket-voice-azelma",
  status,
  size_bytes: 7963896,
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function DownloadsProbe() {
  return <output>{JSON.stringify(useModelDownloads())}</output>;
}

function render(node: React.ReactNode) {
  act(() => {
    if (!root) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    root.render(node);
  });
}

beforeEach(() => {
  fixture.assets = undefined;
  fixture.operatorManaged = false;
  fixture.enabled = [];
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useModelDownloads", () => {
  it("reports speech model downloads with progress and ignores Pocket voices", () => {
    fixture.assets = [
      parakeet("downloading", 420),
      senseVoiceGpu("downloading"),
      encoder("downloading"),
      voice("downloading"),
    ];
    render(<DownloadsProbe />);
    expect(JSON.parse(container!.textContent!)).toEqual([
      {
        assetId: "parakeet-stt",
        item: "speechToText",
        sizeBytes: 661332409,
        progress: 0.42,
      },
      {
        assetId: "sensevoice-stt-webgpu",
        item: "speechToTextSenseVoiceGpu",
        sizeBytes: 937619109,
        progress: null,
      },
      {
        assetId: "pocket-tts-voice-cloning-encoder",
        item: "voiceClone",
        sizeBytes: 39768446,
        progress: null,
      },
    ]);
  });

  it("does not request the list where the operator manages models", () => {
    fixture.operatorManaged = true;
    render(<DownloadsProbe />);
    expect(fixture.enabled).toEqual([false]);
  });
});

describe("ModelDownloadToasts", () => {
  it("announces each finished or failed download once, never the first list", () => {
    fixture.assets = [parakeet("installed"), encoder("downloading")];
    render(<ModelDownloadToasts />);
    expect(toast.success).not.toHaveBeenCalled();

    fixture.assets = [parakeet("downloading", 10), encoder("failed")];
    render(<ModelDownloadToasts />);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Voice Clone encoder download failed",
    );

    fixture.assets = [parakeet("installed"), encoder("failed")];
    render(<ModelDownloadToasts />);
    fixture.assets = [parakeet("installed"), encoder("failed")];
    render(<ModelDownloadToasts />);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Speech-to-Text (Parakeet CPU) ready",
    );
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("stays silent for Pocket voices and cancelled downloads", () => {
    fixture.assets = [voice("downloading"), parakeet("downloading", 5)];
    render(<ModelDownloadToasts />);
    fixture.assets = [voice("installed"), parakeet("not_installed")];
    render(<ModelDownloadToasts />);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
