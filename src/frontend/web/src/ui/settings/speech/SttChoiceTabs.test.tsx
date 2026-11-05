import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import type { OfflineSpeechDownloadsViewProps } from "@/ui/settings/OfflineSpeechDownloads";
import { OfflineSetPanel } from "./OfflineSetPanel";
import { SttChoiceTabs } from "./SttChoiceTabs";

vi.mock("@/lib/speech/offline-stt/clients", () => ({
  offlineSttClients: {},
  OFFLINE_SPEECH_DOWNLOADS_OFFERED: true,
}));
const listing = vi.hoisted(() => ({
  assets: [] as PyModelAssetState[],
  downloadsOffered: true,
}));
vi.mock("@/query/hooks/useModelAssets", () => ({
  useModelAssets: () => ({
    data: {
      assets: listing.assets,
      downloads_offered: listing.downloadsOffered,
    },
  }),
}));

const ENDED_NOTE =
  "Animama no longer offers model downloads. Anything already downloaded keeps working; chat, Avatars and the built-in voices need no downloads.";

const set = (
  id: string,
  extra: Partial<PyModelAssetState> = {},
): PyModelAssetState => ({
  id,
  status: "not_installed",
  size_bytes: 241_000_000,
  required_free_bytes: 482_000_000,
  media_type: null,
  license_ref: "FunASR-Model-License",
  files_total: 3,
  files_verified: 0,
  ...extra,
});
const downloads = (
  extra: Partial<OfflineSpeechDownloadsViewProps> = {},
): OfflineSpeechDownloadsViewProps => ({
  engine: "sensevoice",
  cpu: set("sensevoice-stt"),
  gpu: set("sensevoice-stt-webgpu", { requires: ["sensevoice-stt"] }),
  freeBytes: 40 * 1024 ** 3,
  gpuSupport: "model_missing",
  pending: false,
  onChange: vi.fn(),
  ...extra,
});
const panel = (
  set: "cpu" | "gpu",
  extra: Partial<OfflineSpeechDownloadsViewProps> = {},
  engine: "parakeet" | "sensevoice" = "sensevoice",
  manage = true,
) =>
  renderToStaticMarkup(
    <OfflineSetPanel
      engine={engine}
      set={set}
      downloads={downloads(extra)}
      manage={manage}
    />,
  );

describe("App Settings offline speech versions", () => {
  it("shows a different panel for CPU and GPU, without attribution", () => {
    const cpu = panel("cpu");
    expect(cpu).toContain("Not downloaded");
    expect(cpu).not.toContain("WebGPU available");
    const gpu = panel("gpu");
    expect(gpu).toContain("WebGPU available");
    expect(gpu).toContain("Not downloaded");
    expect(cpu + gpu).not.toContain("attribution");
  });

  it("says which languages each engine recognizes on both versions, never restricting it to an app language", () => {
    for (const set of ["cpu", "gpu"] as const) {
      expect(panel(set)).toContain(
        "Recognizes Japanese, Korean, Chinese and English.",
      );
      expect(panel(set, {}, "parakeet")).toContain("Recognizes English only.");
      expect(panel(set) + panel(set, {}, "parakeet")).not.toContain(
        "while the app language is",
      );
    }
  });

  it("offers removal of an installed set, blocked while the add-on is installed", () => {
    const installed = { status: "installed" } as const;
    expect(
      panel("gpu", { gpu: set("sensevoice-stt-webgpu", installed) }),
    ).toMatch(/<button(?![^>]*disabled="")[^>]*>Remove<\/button>/u);
    const cpu = panel("cpu", {
      cpu: set("sensevoice-stt", installed),
      gpu: set("sensevoice-stt-webgpu", installed),
    });
    expect(cpu).toMatch(/<button[^>]*disabled=""[^>]*>Remove<\/button>/u);
  });

  it.each([true, false])(
    "explains that downloads have ended instead of offering them (manage: %s)",
    (manage) => {
      for (const which of ["cpu", "gpu"] as const) {
        const html = panel(
          which,
          { downloadsEnded: true, freeBytes: 0 },
          "sensevoice",
          manage,
        );
        expect(html).toContain("Not downloaded");
        expect(html).toContain(ENDED_NOTE);
        expect(html).not.toContain("<button");
        expect(html).not.toContain("Not enough free space");
      }
    },
  );

  it("keeps removal of an installed set once downloads have ended", () => {
    const html = panel("cpu", {
      downloadsEnded: true,
      cpu: set("sensevoice-stt", { status: "installed" }),
      gpu: set("sensevoice-stt-webgpu"),
    });
    expect(html).toContain("Downloaded");
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Remove<\/button>/u);
    expect(html).not.toContain(ENDED_NOTE);
  });

  it("shows operator-provided sets without actions", () => {
    const html = panel("cpu", {
      operatorManaged: true,
      cpu: set("sensevoice-stt", { status: "installed" }),
    });
    expect(html).toContain("Downloaded");
    expect(html).not.toContain(">Remove</button>");
  });
});

describe("Speech-to-Text engine tabs", () => {
  const tabs = (selected: "browser" | "sensevoice" | null) =>
    renderToStaticMarkup(
      <SttChoiceTabs
        choice="browser_external"
        choices={["browser_external", "sensevoice_cpu", "sensevoice_gpu"]}
        recommended="browser_external"
        onChoiceChange={vi.fn()}
        panel={() => null}
        selected={selected}
      />,
    );

  it("labels the browser built-in, not recommended, with the Web Speech API", () => {
    const html = tabs(null);
    expect(html).toContain("Browser (built-in)");
    expect(html).not.toContain("Recommended");
    expect(html).toContain(
      "Browser speech recognition via the Web Speech API.",
    );
    expect(html).toContain(
      'href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API"',
    );
  });

  it("names download sizes only while downloads are offered or for installed sets", () => {
    listing.assets = [
      set("sensevoice-stt"),
      set("sensevoice-stt-webgpu", { status: "installed" }),
    ];
    const variants = () =>
      renderToStaticMarkup(
        <SttChoiceTabs
          choice="sensevoice_cpu"
          choices={["browser_external", "sensevoice_cpu", "sensevoice_gpu"]}
          recommended="sensevoice_cpu"
          onChoiceChange={vi.fn()}
          panel={() => null}
          selected="sensevoice"
        />,
      );
    try {
      const offered = variants();
      expect(offered).toMatch(/CPU \(\d/u);
      listing.downloadsOffered = false;
      const ended = variants();
      expect(ended).not.toMatch(/CPU \(/u);
      expect(ended).toMatch(/GPU \(\d/u);
    } finally {
      listing.assets = [];
      listing.downloadsOffered = true;
    }
  });

  it("tags only the engine in use as Selected", () => {
    expect(tabs(null)).not.toContain("Selected");
    const html = tabs("sensevoice");
    expect(html.match(/Selected/gu)).toHaveLength(1);
    expect(html).toMatch(/SenseVoice<span[^>]*>Selected<\/span>/u);
  });
});
