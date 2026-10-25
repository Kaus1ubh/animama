import { renderToStaticMarkup } from "react-dom/server";
import { getI18n } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import {
  DownloadGuardError,
  PACK_WORK_BLOCKS_ASSET,
} from "@/query/model-download-coordination";
import {
  OfflineSpeechDownloads,
  OfflineSpeechDownloadsView,
  modelChangeErrorText,
  requestModelChange,
  useOfflineSpeechDownloads,
  type OfflineSpeechDownloadsViewProps,
} from "./OfflineSpeechDownloads";
import { VoiceDownloads } from "./VoiceDownloads";

const manager = vi.hoisted(() => ({
  assets: [] as PyModelAssetState[],
  retryAssetIds: new Set<string>(),
  mutate: vi.fn(),
  blockedReason: null as string | null,
  offered: true,
  /** Local runtimes administer their own model installation. */
  capabilities: {
    offline_speech_enabled: false,
    local_filesystem_administration: true,
  } as Record<string, unknown>,
}));

const clients = vi.hoisted(() => {
  const client = () => ({
    disposeIdle: vi.fn(async () => true),
    getLastBackendState: () => null,
    getWebgpuStatus: vi.fn(() => new Promise(() => undefined)),
  });
  return { parakeet: client(), sensevoice: client() };
});
vi.mock("@/lib/speech/offline-stt/clients", () => ({
  offlineSttClients: clients,
  get OFFLINE_SPEECH_DOWNLOADS_OFFERED() {
    return manager.offered;
  },
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: () => ({
    availability: () => null,
    install: manager.mutate,
    remove: manager.mutate,
  }),
}));
vi.mock("@/query/hooks/useModelAssets", async (importOriginal) => ({
  // The real operator-managed check reads the mocked runtime capabilities.
  ...(await importOriginal<typeof import("@/query/hooks/useModelAssets")>()),
  useModelAssets: () => ({
    data: { assets: manager.assets, free_bytes: 40 * 1024 ** 3 },
    retryAssetIds: manager.retryAssetIds,
  }),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: manager.capabilities }),
}));
vi.mock("@/query/mutations/useModelAssetActions", () => ({
  useModelAssetAction: () => ({
    mutate: manager.mutate,
    isPending: false,
    busy: false,
    blockedReason: manager.blockedReason,
  }),
}));

const set = (
  id: string,
  size: number,
  extra: Partial<PyModelAssetState> = {},
): PyModelAssetState => ({
  id,
  status: "not_installed",
  size_bytes: size,
  required_free_bytes: size * 2,
  media_type: null,
  license_ref: "CC-BY-4.0",
  files_total: id === "parakeet-stt" ? 7 : 3,
  files_verified: 0,
  ...extra,
});
const cpu = set("parakeet-stt", 661_332_409);
const gpu = set("parakeet-stt-webgpu", 1_238_962_007, {
  requires: ["parakeet-stt"],
});
const senseVoiceCpu = set("sensevoice-stt", 241_000_000, {
  license_ref: "FunASR-Model-License",
});
const senseVoiceGpu = set("sensevoice-stt-webgpu", 938_000_000, {
  license_ref: "FunASR-Model-License",
  requires: ["sensevoice-stt"],
});
const view = (extra: Partial<OfflineSpeechDownloadsViewProps> = {}) =>
  renderToStaticMarkup(
    <OfflineSpeechDownloadsView
      engine="parakeet"
      cpu={cpu}
      gpu={gpu}
      freeBytes={40 * 1024 ** 3}
      gpuSupport="model_missing"
      pending={false}
      onChange={vi.fn()}
      {...extra}
    />,
  );
const enabled = (label: string) =>
  new RegExp(`<button(?![^>]*disabled="")[^>]*>${label}</button>`, "u");
const disabled = (label: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`, "u");

describe("offline speech recognition downloads", () => {
  it("offers a labelled, sized CPU download before install and always shows the GPU add-on", () => {
    const html = view();
    expect(html).toContain("English");
    expect(html).toContain("Parakeet TDT 0.6B v2 by NVIDIA");
    expect(html).toContain("Model attribution (CC BY 4.0)");
    expect(html).toContain("CPU model");
    expect(html).toContain("630.7 MB download");
    expect(html).toMatch(enabled("Download CPU model"));
    expect(html).toContain("GPU acceleration");
    expect(html).toContain("Requires the CPU model");
    expect(html).toMatch(disabled("Download GPU acceleration"));
    expect(html).toContain("Download the CPU model first.");
  });

  it("shows progress and keeps cancellation reachable while blocked", () => {
    const html = view({
      cpu: {
        ...cpu,
        status: "downloading",
        bytes_downloaded: 330_000_000,
        total_bytes: 660_000_000,
      },
      pending: true,
      blockedReason: "Wait for the feature pack change to finish.",
    });
    expect(html).toContain("Downloading 50%");
    expect(html).toContain('value="0.5"');
    expect(html).toMatch(enabled("Cancel download"));
    expect(html).not.toContain("Download CPU model");
  });

  it("offers removal after install and enables the GPU add-on with WebGPU", () => {
    const html = view({ cpu: { ...cpu, status: "installed" } });
    expect(html).toContain("Installed");
    expect(html).toMatch(enabled("Remove CPU model"));
    expect(html).toContain("1.2 GB download");
    expect(html).toMatch(enabled("Download GPU acceleration"));
    expect(html).not.toContain("Download the CPU model first.");
  });

  it("states why the GPU add-on cannot be installed", () => {
    // A device without WebGPU never needs the CPU model for this add-on.
    expect(view({ gpuSupport: "unsupported" })).toContain(
      "WebGPU is not available in this browser or on this device.",
    );
    const missing = view({
      cpu: { ...cpu, status: "installed" },
      gpu: undefined,
    });
    expect(missing).toContain("GPU acceleration is unavailable in this build.");
    expect(missing).toMatch(disabled("Download GPU acceleration"));
    expect(
      view({ cpu: { ...cpu, status: "installed" }, gpuSupport: null }),
    ).toMatch(disabled("Download GPU acceleration"));
  });

  it("blocks CPU removal while GPU acceleration is installed", () => {
    const html = view({
      cpu: { ...cpu, status: "installed" },
      gpu: { ...gpu, status: "installed" },
      gpuSupport: "available",
    });
    expect(html).toMatch(disabled("Remove CPU model"));
    expect(html).toContain("Remove GPU acceleration first.");
    expect(html).toMatch(enabled("Remove GPU acceleration"));
  });

  it("explains removal refusals from the backend without raw payloads", () => {
    const inUse = modelChangeErrorText({
      detail: { code: "model_asset_in_use" },
    });
    expect(inUse).toBe(
      "Speech recognition is in use. Close dictation and Voice Mode to remove it.",
    );
    expect(
      modelChangeErrorText({ detail: { code: "model_asset_required_by" } }),
    ).toBe("Remove GPU acceleration first.");
    expect(modelChangeErrorText(new Error("/private/path"))).not.toContain(
      "/private",
    );
    const html = view({
      cpu: { ...cpu, status: "installed" },
      error: { assetId: "parakeet-stt", message: inUse },
    });
    expect(html).toContain(inUse);
    expect(html).toContain('role="alert"');
  });

  it("offers retry with the failure reason", () => {
    const html = view({
      cpu: { ...cpu, status: "failed", reason: "asset_hash_invalid" },
    });
    expect(html).toMatch(enabled("Retry download"));
    expect(html).toContain("did not match its checksum");
    expect(view({ retryAssetIds: new Set(["parakeet-stt-webgpu"]) })).toContain(
      "Retry download",
    );
  });

  it("says when the server operator turned offline speech off", () => {
    const off = "Offline speech recognition is turned off on this server.";
    expect(
      view({ cpu: { ...cpu, status: "installed" }, turnedOff: true }),
    ).toContain(off);
    // Without the CPU model, the download is the actionable state.
    expect(view({ turnedOff: true })).not.toContain(off);
  });

  it("words the rows and the feature pack guard in the UI Locale", async () => {
    // Thrown in English, shown after the switch: the guard follows the locale.
    const guard = new DownloadGuardError(PACK_WORK_BLOCKS_ASSET);
    await getI18n().changeLanguage("ja");
    try {
      const t = getI18n().getFixedT(null, "voice");
      const html = view();
      expect(html).toContain(t("offlineSpeech.cpu.download"));
      expect(html).not.toContain("Download CPU model");
      expect(modelChangeErrorText(guard)).toBe(
        getI18n().t("app:featurePacks.guards.packChangeRunning"),
      );
    } finally {
      await getI18n().changeLanguage("en");
    }
  });

  it("names SenseVoice's languages, model and licence for its sets", () => {
    const html = view({
      engine: "sensevoice",
      cpu: senseVoiceCpu,
      gpu: senseVoiceGpu,
    });
    expect(html).toContain("Japanese, Korean and Chinese");
    expect(html).toContain("SenseVoice-Small by Alibaba");
    expect(html).toContain("Model attribution (FunASR Model License)");
    expect(html).toContain("FunASR");
    expect(html).not.toContain("Parakeet");
  });

  it("says a set this runtime does not list is not available, once the list loads", () => {
    const loaded = view({ cpu: undefined, gpu: undefined, listLoaded: true });
    expect(loaded).toContain("Not available");
    expect(loaded).not.toContain("Checking");
    expect(loaded).toContain("GPU acceleration is unavailable in this build.");
    expect(view({ cpu: undefined, gpu: undefined })).toContain(
      "Checking offline speech recognition",
    );
  });

  it("never mentions reloading the app", () => {
    for (const html of [
      view(),
      view({ cpu: { ...cpu, status: "installed" } }),
      view({ cpu: { ...cpu, status: "downloading" } }),
    ])
      expect(html).not.toMatch(/reload/iu);
  });
});

describe("sending a model change", () => {
  it("releases the idle leases of the engine whose set is removed", async () => {
    let props!: OfflineSpeechDownloadsViewProps;
    function Probe() {
      props = useOfflineSpeechDownloads("sensevoice");
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(props.engine).toBe("sensevoice");
    props.onChange("remove", "sensevoice-stt");
    await vi.waitFor(() =>
      expect(manager.mutate).toHaveBeenCalledWith(
        { action: "remove", assetId: "sensevoice-stt" },
        expect.anything(),
      ),
    );
    expect(clients.sensevoice.disposeIdle).toHaveBeenCalledOnce();
    expect(clients.parakeet.disposeIdle).not.toHaveBeenCalled();
  });

  it("releases this page's idle leases before sending a removal", async () => {
    const order: string[] = [];
    let finishRelease!: () => void;
    const releaseIdleLeases = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRelease = () => {
            order.push("released");
            resolve();
          };
        }),
    );
    const send = vi.fn(() => order.push("sent"));
    const removal = requestModelChange("remove", "parakeet-stt", {
      releaseIdleLeases,
      send,
    });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    finishRelease();
    await removal;
    expect(order).toEqual(["released", "sent"]);
    expect(send).toHaveBeenCalledWith({
      action: "remove",
      assetId: "parakeet-stt",
    });
  });
  it("installs and cancels without touching leases", async () => {
    const releaseIdleLeases = vi.fn(async () => true);
    const send = vi.fn();
    await requestModelChange("install", "parakeet-stt", {
      releaseIdleLeases,
      send,
    });
    await requestModelChange("cancel", "parakeet-stt", {
      releaseIdleLeases,
      send,
    });
    expect(releaseIdleLeases).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([request]) => request.action)).toEqual([
      "install",
      "remove",
    ]);
  });
});

describe("where speech downloads are offered", () => {
  beforeEach(() => {
    manager.assets = [cpu, gpu, senseVoiceCpu, senseVoiceGpu];
    manager.offered = true;
  });
  /** Engine section headings in document order. */
  const engineOrder = (html: string) =>
    [...html.matchAll(/<h4[^>]*>([^<]+)<\/h4>/gu)].map((match) => match[1]);
  it("shows each engine's downloads in built apps, the UI Locale's first", async () => {
    const html = renderToStaticMarkup(
      <VoiceDownloads section="speech-to-text" />,
    );
    expect(html).toContain("Offline speech recognition</h3>");
    expect(engineOrder(html)).toEqual([
      "English",
      "Japanese, Korean and Chinese",
    ]);
    expect(html.match(/>Download CPU model</gu)).toHaveLength(2);
    expect(html).toContain("Download GPU acceleration");
    await getI18n().changeLanguage("ja");
    try {
      const t = getI18n().getFixedT(null, "voice");
      expect(
        engineOrder(renderToStaticMarkup(<OfflineSpeechDownloads />)),
      ).toEqual([
        t("offlineSpeech.engines.sensevoice.languages"),
        t("offlineSpeech.engines.parakeet.languages"),
      ]);
    } finally {
      await getI18n().changeLanguage("en");
    }
  });
  it("shows only the UI Locale's engine where routed", async () => {
    await getI18n().changeLanguage("ko");
    try {
      const html = renderToStaticMarkup(
        <OfflineSpeechDownloads heading={false} routedOnly />,
      );
      expect(html).not.toContain("<h3");
      expect(engineOrder(html)).toEqual([
        getI18n().t("voice:offlineSpeech.engines.sensevoice.languages"),
      ]);
    } finally {
      await getI18n().changeLanguage("en");
    }
  });
  it("shows the acquire commands instead where Vite serves the operator's host sets", () => {
    manager.offered = false;
    const html = renderToStaticMarkup(<OfflineSpeechDownloads />);
    expect(html).toContain("scripts/models/parakeet.py acquire");
    expect(html).toContain("parakeet_webgpu.py acquire");
    expect(html).toContain("scripts/models/sensevoice.py acquire");
    expect(html).toContain("sensevoice_webgpu.py acquire");
    expect(html).not.toContain("<button");
  });
  it("keeps setup optional with only speech recognition and cloning sections", () => {
    manager.assets = [
      cpu,
      gpu,
      senseVoiceCpu,
      senseVoiceGpu,
      set("pocket-tts-voice-cloning-encoder", 39_768_446),
    ];
    const html = renderToStaticMarkup(<VoiceDownloads />);
    expect(html).toContain("Speech-to-Text</h2>");
    expect(html).toContain("Voice Clone</h2>");
    expect(html).toContain("Download CPU model");
    expect(html).toContain("Download voice cloning");
    expect(html).not.toContain("Text-to-Speech");
    expect(html).not.toContain("Browse voices");
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
    files_total: 1,
    files_verified: 0,
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
    expect(result).toContain("37.9 MB download");
    expect(result).not.toContain("Model attribution</summary>");
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

describe("operator-managed speech models", () => {
  const encoder = set("pocket-tts-voice-cloning-encoder", 39_768_446);
  const managedNote = "Speech models are managed by the hosted operator.";
  beforeEach(() => {
    manager.offered = true;
    manager.retryAssetIds = new Set();
    manager.blockedReason = null;
    // Hosted runtimes provision models; install and removal are refused.
    manager.capabilities = {
      offline_speech_enabled: true,
      offline_speech_asset_version: "fixture",
      local_filesystem_administration: false,
    };
  });
  afterEach(() => {
    manager.capabilities = {
      offline_speech_enabled: false,
      local_filesystem_administration: true,
    };
  });

  it("shows provided and missing Parakeet sets without download or removal", () => {
    const html = view({
      cpu: { ...cpu, status: "installed" },
      gpu,
      gpuSupport: "available",
      operatorManaged: true,
    });
    expect(html).toContain(managedNote);
    expect(html).toContain("CPU model");
    expect(html).toContain("Installed");
    expect(html).toContain("Not available");
    expect(html).not.toContain("<button");
    // No download size or install prerequisite is offered.
    const missing = view({ gpuSupport: "unsupported", operatorManaged: true });
    expect(missing).toContain("Not available");
    for (const markup of [html, missing])
      expect(markup).not.toMatch(
        /B download|Download the CPU model first|WebGPU is not available/,
      );
  });

  it("derives the managed state from the runtime in Settings", () => {
    manager.assets = [{ ...cpu, status: "installed" }, gpu];
    const html = renderToStaticMarkup(
      <VoiceDownloads section="speech-to-text" />,
    );
    expect(html).toContain(managedNote);
    expect(html).not.toContain("<button");
  });

  it.each([
    ["installed", "Installed · Saved clones work without this model."],
    ["not_installed", "Not available"],
  ] as const)(
    "shows a %s voice cloning model without download or removal",
    (status, text) => {
      manager.assets = [{ ...encoder, status }];
      const html = renderToStaticMarkup(
        <VoiceDownloads section="voice-clone" />,
      );
      expect(html).toContain(text);
      expect(html).toContain(managedNote);
      expect(html).not.toContain("<button");
      expect(manager.mutate).not.toHaveBeenCalled();
    },
  );

  it("keeps self-hosted download actions", () => {
    manager.capabilities = { local_filesystem_administration: true };
    manager.assets = [cpu, gpu, encoder];
    const html = renderToStaticMarkup(<VoiceDownloads />);
    expect(html).not.toContain(managedNote);
    expect(html).toContain("Download CPU model");
    expect(html).toContain("Download voice cloning");
  });
});
