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
vi.mock("@/query/hooks/useModelAssets", () => ({
  useModelAssets: () => ({ data: { assets: [] } }),
}));

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
) =>
  renderToStaticMarkup(
    <OfflineSetPanel
      engine="sensevoice"
      set={set}
      routed
      downloads={downloads(extra)}
      manage
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

  it("tags only the engine in use as Selected", () => {
    expect(tabs(null)).not.toContain("Selected");
    const html = tabs("sensevoice");
    expect(html.match(/Selected/gu)).toHaveLength(1);
    expect(html).toMatch(/SenseVoice<span[^>]*>Selected<\/span>/u);
  });
});
