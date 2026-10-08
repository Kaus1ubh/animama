import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { LibrarySharingDialog } from "./LibrarySharingDialog";

const buttons = vi.hoisted(
  () =>
    new Map<string, { disabled: boolean; click: (() => void) | undefined }>(),
);
vi.mock("@/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    disabled = false,
    asChild,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    asChild?: boolean;
    "aria-label"?: string;
  }) => {
    const label =
      ariaLabel ??
      (Array.isArray(children)
        ? children.filter((child) => typeof child === "string").join("")
        : typeof children === "string"
          ? children
          : "");
    buttons.set(label, { disabled, click: onClick });
    return asChild ? (
      children
    ) : (
      <button disabled={disabled} aria-label={ariaLabel}>
        {children}
      </button>
    );
  },
}));
beforeEach(() => buttons.clear());

vi.mock("@/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogTrigger: ({ children }: { children: ReactNode }) => children,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

function flow(overrides: Partial<LibrarySharingFlow> = {}): LibrarySharingFlow {
  return {
    open: true,
    screen: "import-selection",
    mode: "content",
    items: [],
    animas: [],
    inventoryLoading: false,
    inventoryError: null,
    selectedIds: new Set(),
    animaId: null,
    summary: null,
    summaryLoading: false,
    exportReview: null,
    importReview: null,
    stage: null,
    result: null,
    busy: false,
    progress: null,
    error: null,
    notice: null,
    hasRecovery: false,
    commitPending: false,
    downloadStarted: false,
    downloadUrl: null,
    setOpen: vi.fn(),
    back: vi.fn(),
    chooseImport: vi.fn(),
    chooseExport: vi.fn(),
    setMode: vi.fn(),
    toggleItem: vi.fn(),
    selectAnima: vi.fn(),
    refreshInventory: vi.fn(),
    prepareExport: vi.fn(),
    refreshSummary: vi.fn(),
    download: vi.fn(),
    chooseFile: vi.fn(),
    retryUpload: vi.fn(),
    refreshImport: vi.fn(),
    commitImport: vi.fn(),
    recover: vi.fn(),
    discardImport: vi.fn(),
    openAnima: vi.fn(),
    ...overrides,
  };
}
const html = (overrides: Partial<LibrarySharingFlow>) =>
  renderToStaticMarkup(<LibrarySharingDialog flow={flow(overrides)} />);

describe("Library sharing", () => {
  it("offers local file import and content or complete-Anima export", () => {
    const page = html({});
    expect(page).not.toContain("Choose what to export");
    expect(page).not.toContain("Import / Export");
    expect(page).toContain("Drop a .zip file here");
    expect(page).toContain('accept=".zip"');
    expect(buttons.has("Import")).toBe(true);
    expect(buttons.has("Export")).toBe(true);
    expect(page).toContain("local Animama application");
    expect(page).not.toContain("Files stay on your device");
  });
  it("starts the chosen flow through controlled callbacks", () => {
    const current = flow();
    renderToStaticMarkup(<LibrarySharingDialog flow={current} />);
    buttons.get("Import")!.click!();
    expect(current.chooseImport).toHaveBeenCalledOnce();
    buttons.get("Export")!.click!();
    expect(current.chooseExport).toHaveBeenCalledOnce();
    expect(current.chooseFile).not.toHaveBeenCalled();
  });
  it("keeps selection counts authoritative and disables export without a current summary", () => {
    const page = html({
      screen: "export-selection",
      selectedIds: new Set(["one"]),
      items: [{ item_id: "one", name: "Calm", kind: "idle_style" }],
      summary: {
        anima: null,
        digest: "d",
        estimated_size_bytes: 1234,
        selected_count: 1,
        required_count: 2,
        items: [
          {
            item_id: "one",
            name: "Calm",
            kind: "idle_style",
            revision: "r",
            selected: true,
          },
          {
            item_id: "two",
            name: "Wave",
            kind: "gesture",
            revision: "r",
            selected: false,
          },
        ],
      },
    });
    expect(page).toContain("Calm");
    expect(page).toContain("Idle Style");
    expect(page).toContain("2 required dependencies");
    expect(buttons.get("Review export")?.disabled).toBe(false);
    expect(page).toContain("Wave");
    const pending = html({
      screen: "export-selection",
      selectedIds: new Set(["one"]),
      summaryLoading: true,
    });
    expect(pending).toMatch(/<button[^>]*disabled[^>]*>Review export/);
  });
  it("connects the keyboard mode tabs to their active panel", () => {
    const page = html({ screen: "export-selection" });
    expect(page).toContain('role="tabpanel"');
    const panelId = page.match(/role="tabpanel"[^>]*id="([^"]+)"/);
    expect(panelId).not.toBeNull();
    expect(page).toContain(`aria-controls="${panelId![1]}"`);
  });
  it("retains selected identities even when no matching rows are visible", () => {
    const page = html({
      screen: "export-selection",
      items: [],
      selectedIds: new Set(["hidden-root"]),
    });
    expect(page).toContain("1 selected");
    expect(page).toContain("No matching content");
    expect(buttons.get("Review export")?.disabled).toBe(true);
  });
  it("reviews the entire import with resolved names and no per-item controls", () => {
    const page = html({
      screen: "import-review",
      importReview: {
        anima: null,
        expires_at: "2030-01-01",
        filename: "hello.zip",
        items: [
          {
            entry_id: "one",
            kind: "gesture",
            name: "Wave-2",
            original_name: "Wave",
            selected: true,
          },
          {
            entry_id: "two",
            kind: "sound_effect",
            name: "Bell",
            original_name: "Bell",
            selected: false,
          },
        ],
        kind: "content",
        operation_id: "o",
        package_sha256: "s",
        required_count: 1,
        review_digest: "d",
        selected_count: 1,
        size_bytes: 100,
        stage_id: "stage",
      },
    });
    expect(page).toContain("Wave-2");
    expect(page).toContain("Automatically renamed");
    expect(page).toContain("Required items");
    expect(page).not.toContain('role="checkbox"');
    expect(page).toContain("Import 1 item");
    expect(page).toContain("won’t be equipped");
    expect(buttons.get("Change file")?.disabled).toBe(false);
  });
  it("lists non-portable content without offering it for export", () => {
    const page = html({
      screen: "export-selection",
      items: [
        {
          item_id: "sway",
          name: "Sway",
          kind: "gesture",
          portability: "non-portable",
        },
        { item_id: "wave", name: "Wave", kind: "gesture" },
      ],
    });
    expect(page).toContain("Sway");
    expect(page).toContain("use here only");
    expect(page).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Sway" aria-describedby="non-portable-sway"/,
    );
    expect(page).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Wave"/);
  });
  it("explains omitted non-portable items and their import outcome", () => {
    const page = html({
      screen: "import-review",
      importReview: {
        anima: null,
        expires_at: "2030-01-01",
        filename: "hello.zip",
        items: [
          {
            entry_id: "one",
            kind: "idle_style",
            name: "Mixed",
            original_name: "Mixed",
            selected: true,
          },
        ],
        kind: "content",
        operation_id: "o",
        package_sha256: "s",
        required_count: 0,
        review_digest: "d",
        selected_count: 1,
        size_bytes: 100,
        stage_id: "stage",
        non_portable: [
          { kind: "gesture", name: "Sway", outcome: "rebound" },
          { kind: "gesture", name: "Bow", outcome: "unavailable" },
        ],
      },
    });
    expect(page).toContain("Not included in the file (2)");
    expect(page).toContain("Uses this app&#x27;s copy");
    expect(page).toContain("Not available here");
  });
  it("does not offer replacement or discard for an unconfirmed commit", () => {
    const page = html({
      screen: "import-recovery",
      commitPending: true,
      hasRecovery: true,
      error: "Connection interrupted",
    });
    expect(page).toContain("Check import status");
    expect(page).toContain("Connection interrupted");
    expect(page).not.toContain("Choose file");
    expect(page).not.toContain("Discard import");
    expect(page).not.toContain("cancelled");
    expect(buttons.has("Back")).toBe(false);
  });
});

describe("complete package review", () => {
  const anima = {
    display_name: "Luna",
    identity_markdown:
      "# Luna\nEvery line of this long identity remains available.\nFinal identity line.",
    avatar: "avatar",
    gestures: [
      {
        entry_id: "wave",
        semantic_key: "greeting",
        config: { duration_seconds: 3, blend_in: 0.25 },
      },
    ],
    reactions: {
      joy: {
        "1": { entry_id: "wave", config: { gain: 0.4 } },
        "2": null,
        "3": null,
      },
    },
    idle_style: null,
    appearance: { profile: null, background: null },
  };
  const manifest = {
    schema: "animama-content-package/3" as const,
    kind: "anima" as const,
    anima,
    root_entry_ids: [],
    avatar_portraits: [],
    capabilities: [],
    entries: [
      {
        package_entry_id: "avatar",
        logical_key: "avatar",
        display_name: "Mira",
        kind: "avatar" as const,
        portable_revision_sha256: "r",
        dependencies: [],
        files: [],
      },
      {
        package_entry_id: "wave",
        logical_key: "wave",
        display_name: "Hello",
        kind: "gesture" as const,
        portable_revision_sha256: "r",
        dependencies: [],
        files: [],
      },
    ],
  };
  const completeManifest = {
    ...manifest,
    avatar_portraits: [
      { avatar_entry_id: "avatar", appearance_entry_id: "portrait" },
    ],
    entries: [
      manifest.entries[0],
      {
        ...manifest.entries[1],
        dependencies: [
          { content_type: "scene_effect" as const, ref: "scene" },
          { content_type: "sound_effect" as const, ref: "sound" },
        ],
      },
      ...[
        {
          id: "scene",
          name: "Greeting backdrop",
          kind: "scene_effect" as const,
        },
        { id: "sound", name: "Greeting chime", kind: "sound_effect" as const },
        { id: "portrait", name: "Mira portrait", kind: "appearance" as const },
      ].map(({ id, name, kind }) => ({
        package_entry_id: id,
        logical_key: id,
        display_name: name,
        kind,
        portable_revision_sha256: "r",
        dependencies: [],
        files: [],
      })),
    ],
  };
  it.each(["export-selection", "export-review"] as const)(
    "names every Anima package member, including indirect effects and portrait, in %s",
    (screen) => {
      const page = html({
        screen,
        mode: "anima",
        summary: {
          anima,
          digest: "d",
          estimated_size_bytes: 1000,
          selected_count: 0,
          required_count: completeManifest.entries.length,
          items: completeManifest.entries.map((entry) => ({
            item_id: entry.package_entry_id,
            name: entry.display_name,
            kind: entry.kind,
            revision: entry.portable_revision_sha256,
            selected: false,
          })),
        },
        exportReview: {
          digest: "d",
          expires_at: "2030-01-01",
          export_id: "e",
          filename: "Luna.zip",
          manifest: completeManifest,
          package_sha256: "s",
          required_count: completeManifest.entries.length,
          selected_count: 0,
          size_bytes: 1000,
        },
      });
      for (const entry of completeManifest.entries)
        expect(page).toContain(entry.display_name);
      expect(page.match(/Required items/g)).toHaveLength(1);
      expect(page).toContain("Final identity line.");
      expect(page).toContain("Equipment and configuration");
      expect(page).toContain("other private settings are left out");
    },
  );
  it.each(["export-selection", "export-review", "import-review"] as const)(
    "reviews the active encoded voice as a required dependency in %s",
    (screen) => {
      const voiceAnima = { ...anima, pocket_voice: "voice" };
      const entries = [
        ...completeManifest.entries,
        {
          package_entry_id: "voice",
          logical_key: "narrator",
          display_name: "Narrator",
          kind: "voice" as const,
          portable_revision_sha256: "v",
          dependencies: [],
          files: [],
        },
      ];
      const page = html({
        screen,
        mode: "anima",
        summary: {
          anima: voiceAnima,
          digest: "d",
          estimated_size_bytes: 1000,
          selected_count: 0,
          required_count: entries.length,
          items: entries.map((entry) => ({
            item_id: entry.package_entry_id,
            name: entry.display_name,
            kind: entry.kind,
            revision: entry.portable_revision_sha256,
            selected: false,
          })),
        },
        exportReview: {
          digest: "d",
          expires_at: "2030-01-01",
          export_id: "e",
          filename: "Luna.zip",
          manifest: { ...completeManifest, anima: voiceAnima, entries },
          package_sha256: "s",
          required_count: entries.length,
          selected_count: 0,
          size_bytes: 1000,
        },
        importReview: {
          anima: voiceAnima,
          expires_at: "2030-01-01",
          filename: "Luna.zip",
          items: entries.map((entry) => ({
            entry_id: entry.package_entry_id,
            kind: entry.kind,
            name: entry.display_name,
            original_name: entry.display_name,
            selected: false,
          })),
          kind: "anima",
          operation_id: "o",
          package_sha256: "s",
          required_count: entries.length,
          review_digest: "d",
          selected_count: 0,
          size_bytes: 1000,
          stage_id: "stage",
        },
      });
      expect(page).toContain("PocketTTS voice: </span>Narrator");
      expect(page).toContain(
        "Encoded voice only; the original recording is not included.",
      );
      expect(page).toContain("Voice</span><span>1</span>");
      expect(page).toContain(`(${entries.length})`);
      expect(page).not.toContain("credentials, voice settings");
    },
  );

  it("keeps one complete required-items disclosure on Anima import", () => {
    const page = html({
      screen: "import-review",
      importReview: {
        anima,
        expires_at: "2030-01-01",
        filename: "Luna.zip",
        items: completeManifest.entries.map((entry) => ({
          entry_id: entry.package_entry_id,
          kind: entry.kind,
          name: entry.display_name,
          original_name: entry.display_name,
          selected: false,
        })),
        kind: "anima",
        operation_id: "o",
        package_sha256: "s",
        required_count: completeManifest.entries.length,
        review_digest: "d",
        selected_count: 0,
        size_bytes: 1000,
        stage_id: "stage",
      },
    });
    for (const entry of completeManifest.entries)
      expect(page).toContain(entry.display_name);
    expect(page.match(/Required items/g)).toHaveLength(1);
  });
  it("shows full saved Anima identity, all equipment cells and authored configuration", () => {
    const page = html({
      screen: "export-review",
      mode: "anima",
      exportReview: {
        digest: "d",
        expires_at: "2030-01-01",
        export_id: "e",
        filename: "Luna.zip",
        manifest,
        package_sha256: "s",
        required_count: 2,
        selected_count: 0,
        size_bytes: 1000,
      },
    });
    expect(page).toContain("Final identity line.");
    expect(page).toContain("greeting: Hello");
    expect(page).toContain("duration seconds");
    expect(page).toContain("0.25");
    expect(page).toContain("gain");
    expect(page).toContain("0.4");
    expect(page).toContain(" · 2: None");
    expect(page).toContain("Idle Style: </span>None");
    expect(page).not.toContain("PocketTTS voice: </span>");
    expect(page).toContain("Export Anima");
    expect(page).not.toMatch(/Edit export copy|Music/);
  });
  it("lists non-portable items the export leaves out", () => {
    const page = html({
      screen: "export-review",
      exportReview: {
        digest: "d",
        expires_at: "2030-01-01",
        export_id: "e",
        filename: "hello.zip",
        manifest: {
          ...manifest,
          kind: "content",
          anima: null,
          root_entry_ids: ["wave"],
          non_portable_references: [
            {
              kind: "gesture",
              logical_key: "builtin:gesture:sway",
              display_name: "Sway",
              uses: [{ entry_id: "wave", pools: ["default"] }],
            },
          ],
        },
        package_sha256: "s",
        required_count: 0,
        selected_count: 1,
        size_bytes: 1000,
      },
    });
    expect(page).toContain("Not included in the file (1)");
    expect(page).toContain("Sway");
    expect(page).toContain("uses their own copy");
  });
  it("uses prepared content names and only reports that a download started", () => {
    const page = html({
      screen: "export-review",
      downloadStarted: true,
      exportReview: {
        digest: "d",
        expires_at: "2030-01-01",
        export_id: "e",
        filename: "hello.zip",
        manifest: {
          ...manifest,
          kind: "content",
          anima: null,
          root_entry_ids: ["wave"],
        },
        package_sha256: "s",
        required_count: 1,
        selected_count: 1,
        size_bytes: 1000,
      },
    });
    expect(page).toContain("Hello");
    expect(page).toContain("Download package");
    expect(page).toContain("Download started");
    expect(page).not.toMatch(/Download complete|Downloaded successfully/);
  });
  it("keeps an installed Anima visible after runtime preparation fails", () => {
    const page = html({
      screen: "complete",
      error: "Runtime content unavailable. Your Anima remains installed.",
      result: {
        anima_id: "new",
        items: [],
        operation_id: "o",
        package_sha256: "s",
        review_digest: "d",
      },
    });
    expect(page).toContain("Import complete");
    expect(page).toContain("remains installed");
    expect(page).toContain("Open Anima");
    expect(page).toContain("View in Library");
  });
});
