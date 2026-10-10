import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getI18n } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentHealth, contentDiagnosticText } from "./ContentHealth";

const state = vi.hoisted(() => ({
  catalog: { data: undefined, isError: false, isFetching: false } as {
    data:
      | undefined
      | {
          scan_required: boolean;
          items: Array<{
            item_id: string;
            display_name: string;
            status: string;
            diagnostics: Array<{
              code: string;
              message: string;
              relative_path?: string;
            }>;
          }>;
        };
    isError: boolean;
    isFetching: boolean;
  },
  rescan: { isError: false, isPending: false, mutate: vi.fn() },
  hostAdministration: true,
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    data: { local_filesystem_administration: state.hostAdministration },
  }),
}));

vi.mock("@/query/hooks/useContentCatalog", () => ({
  useContentCatalog: () => state.catalog,
  useRescanContent: () => state.rescan,
}));

// Render disclosure contents for assertions without depending on a browser portal.
vi.mock("@/ui/components/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

beforeEach(() => {
  state.catalog = {
    data: { scan_required: false, items: [] },
    isError: false,
    isFetching: false,
  };
  state.rescan.isError = false;
  state.rescan.isPending = false;
  state.hostAdministration = true;
});

describe("content attention indicator", () => {
  it.each([false, true])(
    "stays silent for healthy content during background fetching=%s",
    (isFetching) => {
      state.catalog.isFetching = isFetching;
      state.catalog.data!.items.push({
        item_id: "valid",
        display_name: "Healthy Avatar",
        status: "valid",
        diagnostics: [],
      });
      expect(renderToStaticMarkup(<ContentHealth />)).toBe("");
    },
  );

  it("stays silent before the initial catalog arrives", () => {
    state.catalog.data = undefined;
    state.catalog.isFetching = true;
    expect(renderToStaticMarkup(<ContentHealth />)).toBe("");
  });

  it("hides a previous retry error once the catalog is healthy", () => {
    state.rescan.isError = true;
    expect(renderToStaticMarkup(<ContentHealth />)).toBe("");
  });

  it("shows unavailable status and a retry when the catalog cannot load", () => {
    state.catalog.isError = true;
    const html = renderToStaticMarkup(<ContentHealth compact />);
    expect(html).toContain('aria-label="Content library unavailable"');
    expect(html).toContain("Retry scan");
  });

  it("keeps catalog retry and diagnostics while withholding hosted host scan", () => {
    state.catalog.isError = true;
    state.hostAdministration = false;
    const html = renderToStaticMarkup(<ContentHealth />);
    expect(html).toContain("Content library unavailable");
    expect(html).toContain("Retry Library");
    expect(html).toContain("Host file scanning is managed by the operator.");
    expect(html).not.toContain("Retry scan");
  });

  it("lists only affected items and their validation details", () => {
    state.catalog.data!.items = [
      {
        item_id: "valid",
        display_name: "Healthy Avatar",
        status: "valid",
        diagnostics: [],
      },
      {
        item_id: "broken",
        display_name: "Missing model",
        status: "missing",
        diagnostics: [
          {
            code: "missing_file",
            message: "Model bytes are missing.",
            relative_path: "avatars/model.vrm",
          },
        ],
      },
    ];
    const html = renderToStaticMarkup(<ContentHealth />);
    expect(html).toContain('aria-label="Content needs attention"');
    expect(html).toContain("Missing model");
    expect(html).toContain("Model bytes are missing.");
    expect(html).toContain("missing_file · avatars/model.vrm");
    expect(html).not.toContain("Healthy Avatar");
    expect(html).toContain("Retry scan");
  });

  it("exposes pending scan state even without an affected item", () => {
    state.catalog.data!.scan_required = true;
    const html = renderToStaticMarkup(<ContentHealth />);
    expect(html).toContain('aria-label="Content needs attention"');
    expect(html).toContain("Local changes need another scan.");
    expect(html).toContain("Retry scan");
  });

  it("keeps failed retry visible and disables duplicate retries while scanning", () => {
    state.catalog.data!.scan_required = true;
    state.rescan.isError = true;
    const html = renderToStaticMarkup(<ContentHealth />);
    expect(html).toContain("The scan failed. Try again.");
    state.rescan.isError = false;
    state.rescan.isPending = true;
    const scanning = renderToStaticMarkup(<ContentHealth />);
    expect(scanning).toContain("Scanning…");
    expect(scanning).toContain('disabled=""');
  });

  it("words known diagnostic codes instead of the backend's English", () => {
    state.catalog.data!.items = [
      {
        item_id: "empty",
        display_name: "Empty clip",
        status: "invalid",
        diagnostics: [
          { code: "empty_file", message: "Content files cannot be empty" },
          { code: "invalid_png_header", message: "PNG signature is invalid" },
        ],
      },
    ];
    const html = renderToStaticMarkup(<ContentHealth />);
    expect(html).toContain("Content files cannot be empty.");
    expect(html).toContain("The PNG file signature is invalid.");
    expect(html).not.toContain("PNG signature is invalid<");
  });
});

describe("content diagnostic wording", () => {
  const t = getI18n().getFixedT(null, "contentHealth");
  const unworded = { code: "future_code", message: "Backend detail." };

  afterEach(async () => {
    await getI18n().changeLanguage("en");
  });

  it("shows an unworded diagnostic's English message in English", () => {
    expect(contentDiagnosticText(t, unworded)).toEqual({
      message: "Backend detail.",
      detail: null,
    });
  });

  it("keeps the English as secondary detail in other locales", async () => {
    await getI18n().changeLanguage("ja");
    expect(
      contentDiagnosticText(
        getI18n().getFixedT(null, "contentHealth"),
        unworded,
      ),
    ).toEqual({
      message: getI18n().t("contentHealth:itemStatus.invalid"),
      detail: "Backend detail.",
    });
  });
});
