// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AvatarLiveDiagnostics } from "@/lib/avatar/diagnostics/avatarDiagnostics";
import {
  avatarDiagnosticsJson,
  avatarDiagnosticsText,
  buildAvatarDiagnosticsReport,
} from "@/lib/avatar/diagnostics/avatarDiagnosticsReport";
import { AnimaSettingsModal } from "@/ui/main/header/AnimaSettingsModal";
import type { AvatarDiagnosticsView } from "./useAvatarDiagnostics";

const diagnostics = vi.hoisted(() => ({
  view: null as AvatarDiagnosticsView | null,
}));
vi.mock("./useAvatarDiagnostics", () => ({
  useAvatarDiagnostics: () => diagnostics.view,
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({
    userPreferences: {},
    animaPreferences: {},
    updateAnimaPreferences: vi.fn(),
    isLoading: false,
    isUpdating: false,
  }),
}));
// The panel's Avatar settings rows have their own tests.
vi.mock("@/query/hooks/useAvatarSettings", () => ({
  useAvatarSettingsAvailable: () => ({ available: false, checking: false }),
  useAvatarSettings: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/query/mutations/useSaveAvatarSettings", () => ({
  useSaveAvatarSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/query/hooks/useAnimaLoadout", () => ({
  useAnimaLoadout: () => ({ data: undefined }),
}));
vi.mock("@/query/hooks/useAnimaRuntimeCatalog", () => ({
  useAnimaRuntimeCatalog: () => ({ data: undefined }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const live: AvatarLiveDiagnostics = {
  face: {
    detected: true,
    parts: [
      {
        role: "face_skin",
        source: "signals",
        bindingCount: 1,
        regionCount: 0,
        confidence: 0.9,
      },
      {
        role: "eyeline",
        source: "missing",
        bindingCount: 0,
        regionCount: 0,
        confidence: 0,
      },
      {
        role: "eyelash",
        source: "signals",
        bindingCount: 0,
        regionCount: 2,
        confidence: 0.5,
      },
    ],
    landmarks: "ready",
    textureAnchors: "ready",
  },
  expressions: {
    presets: [
      { name: "happy", source: "model" },
      { name: "relaxed", source: "arkit" },
    ],
    missingPresets: ["lookUp"],
    arkit: { resolved: 41, total: 52, playsFaces: true },
    unresolved: { names: ["surprised"], otherCount: 2 },
  },
  motion: {
    humanoidBones: 52,
    missingRequiredBones: [],
    springJoints: 120,
    springColliders: 18,
    wind: { mode: "off", ambientForces: false },
    restPose: null,
  },
  materials: { mode: "simple", lilToon: "fallback" },
  issues: [
    {
      code: "effect_face_part_missing",
      params: { effectId: "fx-1", part: "eyeline" },
    },
  ],
};

const report = buildAvatarDiagnosticsReport({
  avatar: { source: "local", itemId: "item-9" },
  file: {
    byteLength: 12 * 1024 * 1024,
    container: "glb",
    vrmVersion: "1.0",
    extensionsUsed: ["VRMC_vrm", "KHR_texture_transform"],
    extensionsRequired: [],
    meshCount: 3,
    primitiveCount: 17,
    morphedPrimitiveCount: 2,
    materialCount: 12,
    materialKinds: { mtoon: 10, liltoon: 2, unlit: 0, pbr: 0 },
    textures: [
      { mimeType: "image/png", byteLength: 4096, width: 2048, height: 1024 },
    ],
  },
  live,
  settings: {
    springMode: "off",
    springModeSource: "stored",
    materialMode: "simple",
    materialModeSource: "stored",
  },
});

let root: Root | null = null;

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(<AnimaSettingsModal animaId="anima-1" />);
  });
}

const buttonNamed = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === name,
  );

function click(name: string) {
  const button = buttonNamed(name);
  if (!button) throw new Error(`No button named ${name}`);
  act(() => button.click());
}

const dialog = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  diagnostics.view = {
    state: { status: "ready", report, issues: live.issues, live: false },
    effectNames: new Map([["fx-1", "Sparkle"]]),
  };
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("AvatarDiagnosticsDialog", () => {
  it("opens from the Anima settings panel on the File section", () => {
    render();
    expect(dialog()).toBeNull();
    click("Open diagnostics");

    const text = dialog()?.textContent ?? "";
    expect(text).toContain("Local Avatar · loaded for this view");
    expect(text).toContain("GLB · VRM 1.0");
    expect(text).toContain("KHR_texture_transform");
    expect(text).toContain("MToon 10");
    expect(text).toContain("2,048 × 1,024");
    expect(text).toContain("Simple materials · set to Simple");
    // Focus moves into the dialog.
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it("shows every section", () => {
    render();
    click("Open diagnostics");

    click("Face");
    expect(dialog()?.textContent).toContain("Face skin");
    expect(dialog()?.textContent).toContain("Model data");
    expect(dialog()?.textContent).toContain("Not found");
    expect(dialog()?.textContent).toContain("2 inside shared parts");

    click("Expressions");
    expect(dialog()?.textContent).toContain("relaxed (ARKit)");
    expect(dialog()?.textContent).toContain("41 of 52");
    expect(dialog()?.textContent).toContain("2 custom names");

    click("Motion");
    expect(dialog()?.textContent).toContain("120 joints · 18 colliders");
    expect(dialog()?.textContent).toContain("Off · no wind or updraft");
    expect(dialog()?.textContent).toContain("Saved for this Avatar");
    expect(dialog()?.textContent).toContain("Not checked yet");

    click("Warnings (1)");
    expect(dialog()?.textContent).toContain(
      "Sparkle was skipped: this Avatar has no detected eye lines.",
    );
    expect(dialog()?.textContent).toContain("effect_face_part_missing");

    click("Raw JSON");
    const tree = dialog()?.querySelector(
      '[role="group"][aria-label="Raw JSON"]',
    );
    expect(tree?.textContent).toContain(
      '"schema": "animama/avatar-diagnostics/1"',
    );
  });

  it("expands and collapses the Raw JSON tree", () => {
    render();
    click("Open diagnostics");
    click("Raw JSON");
    const toggle = (name: string) =>
      [...dialog()!.querySelectorAll("button[aria-expanded]")].find((button) =>
        button.textContent?.startsWith(`"${name}"`),
      );
    // The top two levels start open; deeper containers start collapsed.
    expect(toggle("file")?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle("extensionsUsed")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(dialog()?.textContent).not.toContain('"KHR_texture_transform"');

    act(() => (toggle("extensionsUsed") as HTMLButtonElement).click());
    expect(dialog()?.textContent).toContain('"KHR_texture_transform"');

    click("Collapse all");
    expect(toggle("file")?.getAttribute("aria-expanded")).toBe("false");
    click("Expand all");
    const states = [...dialog()!.querySelectorAll("button[aria-expanded]")].map(
      (button) => button.getAttribute("aria-expanded"),
    );
    expect(states.length).toBeGreaterThan(5);
    expect(new Set(states)).toEqual(new Set(["true"]));
  });

  it("copies the text report and the JSON", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render();
    click("Open diagnostics");

    await act(async () => buttonNamed("Copy report")!.click());
    expect(writeText).toHaveBeenLastCalledWith(avatarDiagnosticsText(report));
    expect(toast.success).toHaveBeenLastCalledWith("Report copied.");

    click("Raw JSON");
    await act(async () => buttonNamed("Copy JSON")!.click());
    expect(writeText).toHaveBeenLastCalledWith(avatarDiagnosticsJson(report));
    vi.unstubAllGlobals();
  });

  it("navigates sections with buttons and closes on Escape", () => {
    render();
    click("Open diagnostics");
    const face = buttonNamed("Face")!;
    expect(buttonNamed("File")!.getAttribute("aria-current")).toBe("page");
    act(() => face.focus());
    expect(document.activeElement).toBe(face);
    act(() => face.click());
    expect(face.getAttribute("aria-current")).toBe("page");

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(dialog()).toBeNull();
  });

  it("shows the loading and unavailable states", () => {
    diagnostics.view = { state: { status: "loading" }, effectNames: new Map() };
    render();
    click("Open diagnostics");
    expect(dialog()?.textContent).toContain("Reading the Avatar…");
    expect(buttonNamed("Copy report")!.disabled).toBe(true);

    diagnostics.view = {
      state: { status: "unavailable" },
      effectNames: new Map(),
    };
    act(() => root?.render(<AnimaSettingsModal animaId="anima-1" />));
    expect(dialog()?.textContent).toContain(
      "This Anima has no Avatar to check.",
    );
  });
});
