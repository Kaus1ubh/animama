import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import type { PyGesture, PyIdleStyle } from "@/lib/content/catalogTypes";
import type { ContentEditRecovery } from "@/lib/content/contentEditRecovery";
import { IdleStyleEditorPage } from "./IdleStyleEditorPage";

const fixture = vi.hoisted(() => ({
  style: undefined as PyIdleStyle | undefined,
  recovery: null as ContentEditRecovery | null,
  gestures: [] as PyGesture[],
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: PropsWithChildren) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@/query/hooks/useIdleStyles", () => ({
  useIdleStyle: () => ({
    data: fixture.style,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/query/hooks/useActions", () => ({
  useGestures: () => ({
    data: { pages: [{ items: fixture.gestures }] },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/query/hooks/useIdleGesturePlayback", () => ({
  useIdleGesturePlayback: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@/ui/content-preview/ContentPreviewDockProvider", () => ({
  useContentPreviewDock: () => ({ openPreview: vi.fn() }),
}));
vi.mock("@/ui/content-health/ContentHealth", () => ({
  ContentHealth: () => null,
}));
vi.mock("@/lib/content/contentEditRecovery", () => ({
  CONTENT_EDIT_RECOVERY_SCHEMA: "animama/content-edit-recovery/1",
  loadContentEditRecovery: () => fixture.recovery,
  saveContentEditRecovery: vi.fn(),
  clearContentEditRecovery: vi.fn(),
}));

const existing: PyIdleStyle = {
  item_id: "rest",
  logical_key: "local:idle-style:rest",
  revision_sha256: "revision",
  name: "Rest",
  description: null,
  state: "ready",
  origin: "owned",
  catalog_source: "local",
  source: { type: "catalog", catalog_item_id: "rest" },
  created_at: null,
  updated_at: null,
  schema_version: 2,
  default_pool: [],
  cells: {},
  dependencies: [],
};
const saveButton = (html: string) =>
  html.match(/<button[^>]*>Save Idle Style<\/button>/)?.[0] ?? "";

beforeEach(() => {
  fixture.style = existing;
  fixture.recovery = null;
  fixture.gestures = [];
});

describe("Idle Style editor", () => {
  it("keeps an admitted locator member editable using its exact Gesture identity", () => {
    fixture.style = {
      ...existing,
      default_pool: ["gestures/breathe"],
      dependencies: [
        { kind: "gesture", ref: "gestures/breathe", item_id: "breathing" },
      ],
    };
    fixture.gestures = [
      {
        kind: "gesture",
        item_id: "breathing",
        logical_key: "local:gesture:breathing",
        name: "Breathing",
        implementation_kind: "vrma",
        description: null,
        source: { type: "catalog", catalog_item_id: "breathing" },
        origin: "owned",
        state: "ready",
        created_at: null,
        updated_at: null,
      },
    ];
    const html = renderToStaticMarkup(<IdleStyleEditorPage itemId="rest" />);
    expect(html).toContain('aria-label="Preview Breathing"');
    expect(html).not.toContain('<option value="breathing">');
    expect(saveButton(html)).toContain(' disabled=""');
  });

  it("shows all three intensity columns and keeps unchanged Local Save disabled", () => {
    const html = renderToStaticMarkup(<IdleStyleEditorPage itemId="rest" />);
    expect(html).toContain("Joy intensity 1");
    expect(html).toContain("Joy intensity 2");
    expect(html).toContain("Joy intensity 3");
    expect(html).not.toContain('type="file"');
    expect(html).toContain("Add an existing Gesture");
    expect(saveButton(html)).toContain(' disabled=""');
  });

  it("allows retrying a recovered Save even when its draft equals the currently visible item", () => {
    fixture.recovery = {
      schema: "animama/content-edit-recovery/1",
      userId: "owner",
      family: "idle-style",
      documentKey: "rest",
      operationId: "pending-operation",
      updatedAt: "2026-09-24T00:00:00Z",
      form: {
        name: "Rest",
        description: "",
        document: { defaultPool: [], cells: {} },
        request: "original-request",
      },
    };
    const html = renderToStaticMarkup(<IdleStyleEditorPage itemId="rest" />);
    expect(saveButton(html)).not.toBe("");
    expect(saveButton(html)).not.toContain(' disabled=""');
  });

  it("customizes Included Styles as Local copies and permits an empty Default", () => {
    fixture.style = {
      ...existing,
      origin: "builtin",
      catalog_source: "included",
      editable: false,
    };
    const html = renderToStaticMarkup(<IdleStyleEditorPage itemId="rest" />);
    expect(html).toContain("Save Local copy");
    expect(html).toContain("The original Style stays unchanged.");
    expect(html).not.toContain("at least one");
  });
});
