import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import type { FeaturePackStatus } from "../../../../shared/desktop-runtime";
import { OfflineSpeechDownload, VoiceDownloads } from "./VoiceDownloads";

const manager = vi.hoisted(() => ({
  assets: [] as PyModelAssetState[],
  packs: [] as FeaturePackStatus[],
  retryAssetIds: new Set<string>(),
  mutate: vi.fn(),
  blockedReason: null as string | null,
}));

vi.mock("@/hooks/useDesktopFeaturePacks", () => ({
  useDesktopFeaturePacks: () => ({
    available: true,
    packs: manager.packs,
    run: manager.mutate,
  }),
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: () => ({
    availability: () => null,
    install: manager.mutate,
    remove: manager.mutate,
  }),
}));
vi.mock("@/query/hooks/useModelAssets", () => ({
  useModelAssets: () => ({
    data: { assets: manager.assets },
    retryAssetIds: manager.retryAssetIds,
  }),
}));
vi.mock("@/query/mutations/useModelAssetActions", () => ({
  useModelAssetAction: () => ({
    mutate: manager.mutate,
    isPending: false,
    blockedReason: manager.blockedReason,
  }),
}));
vi.mock("./ExperimentalSettings", () => ({
  ParakeetWebgpuDetails: () => <button>Download GPU enhancement</button>,
}));

const pack: FeaturePackStatus = {
  id: "parakeet-stt",
  state: "not_installed",
  available: true,
  hasInstalledFiles: false,
  downloadBytes: 661_332_409,
  installedBytes: 661_332_409,
  minimumFreeBytes: 1_322_664_818,
};
const render = (
  extra: Partial<Parameters<typeof OfflineSpeechDownload>[0]> = {},
) =>
  renderToStaticMarkup(
    <OfflineSpeechDownload
      pack={pack}
      busy={false}
      blockedReason={null}
      run={vi.fn()}
      {...extra}
    />,
  );

describe("compact optional speech download", () => {
  it("offers one immediate sized CPU action without selecting a provider or chaining a GPU download", () => {
    const html = render();
    expect(html).toContain("Offline speech recognition");
    expect(html).toContain("631 MB");
    expect(html).toContain("Download speech recognition");
    expect(html).not.toContain("checkbox");
    expect(html).not.toContain("GPU");
  });

  it("blocks transitions for credentials but keeps cancellation reachable", () => {
    const html = render({
      blockedReason: "Save or discard your API key first.",
    });
    expect(html).toContain("Save or discard your API key first.");
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Download speech recognition<\/button>/u,
    );
    const downloading = render({
      pack: { ...pack, state: "downloading", progress: 0.5 },
      busy: true,
    });
    expect(downloading).toContain("50%");
    expect(downloading).toMatch(
      /<button(?![^>]*disabled="")[^>]*>Cancel download<\/button>/u,
    );
  });

  it("preserves installed pack removal when its catalog offer disappears", () => {
    const html = render({
      pack: {
        ...pack,
        available: false,
        state: "installed",
        hasInstalledFiles: true,
      },
    });
    expect(html).toContain("Remove speech recognition");
    expect(html).not.toContain("Download speech recognition");
  });
});

describe("optional speech synthesis downloads", () => {
  const encoder: PyModelAssetState = {
    id: "pocket-tts-voice-cloning-encoder",
    status: "not_installed",
    size_bytes: 39_768_446,
    required_free_bytes: 39_768_446,
    media_type: "application/octet-stream",
    license_ref: "pocket-tts-voice-cloning",
  };
  beforeEach(() => {
    manager.assets = [{ ...encoder }];
    manager.retryAssetIds = new Set();
    manager.blockedReason = null;
  });
  const html = () =>
    renderToStaticMarkup(<VoiceDownloads section="voice-clone" />);
  it("offers only the sized cloning action without a voice browser or eager install", () => {
    const result = html();
    expect(result).not.toContain("PocketTTS voices");
    expect(result).not.toContain("Browse voices");
    expect(result).toContain("Download voice cloning");
    expect(result).toContain("38 MB download");
    expect(result).not.toContain("Select Eve");
    expect(manager.mutate).not.toHaveBeenCalled();
  });
  it("reconciles retry and installed states from the shared manager", () => {
    manager.retryAssetIds.add(encoder.id);
    expect(html()).toContain("Retry cloning download");
    manager.assets[0].status = "installed";
    expect(html()).toContain("Remove voice cloning");
    expect(html()).toContain("Saved clones work without this model");
    expect(html()).not.toContain("Retry cloning download");
  });
  it("keeps cancellation available during a raced native transition", () => {
    manager.assets[0].status = "downloading";
    manager.blockedReason = "Speech recognition is being activated.";
    expect(html()).toContain(manager.blockedReason);
    expect(html()).toMatch(
      /<button(?![^>]*disabled="")[^>]*>Cancel download<\/button>/u,
    );
  });
});

describe("provider-scoped speech downloads", () => {
  beforeEach(() => {
    manager.packs = [pack];
  });
  const speech = (sttProvider: string) =>
    renderToStaticMarkup(
      <VoiceDownloads section="speech-to-text" sttProvider={sttProvider} />,
    );
  it.each(["browser_external", "browser_local", "deepgram", ""])(
    "hides GPU but keeps the desktop base download reachable for %s",
    (provider) => {
      expect(speech(provider)).not.toContain("Download GPU enhancement");
      expect(speech(provider)).toContain("Download speech recognition");
    },
  );
  it("offers the base model for CPU and adds GPU only for WebGPU", () => {
    expect(speech("parakeet")).toContain("Download speech recognition");
    expect(speech("parakeet")).not.toContain("Download GPU enhancement");
    expect(speech("parakeet_webgpu")).toContain("Download speech recognition");
    expect(speech("parakeet_webgpu")).toContain("Download GPU enhancement");
  });
  it("keeps setup optional with only speech recognition and cloning sections", () => {
    const html = renderToStaticMarkup(<VoiceDownloads />);
    expect(html).toContain("Speech-to-Text</h2>");
    expect(html).toContain("Voice Clone</h2>");
    expect(html).toContain("Download GPU enhancement");
    expect(html).not.toContain("Text-to-Speech");
    expect(html).not.toContain("Browse voices");
    expect(html).not.toContain("PocketTTS voices");
  });
});
