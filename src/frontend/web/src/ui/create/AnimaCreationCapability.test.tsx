import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedExclusionReasons } from "@/app/runtime/route-admission";
import { AnimaCarousel } from "@/ui/animas/AnimaCarousel";
import { PreviewCreateAnimaAction } from "@/ui/content-preview/ContentPreviewHost";
import { CreateHubPage } from "@/ui/create/CreateHubPage";
import { SidebarCreateMenu } from "@/ui/sidebar/SidebarCreateMenu";
import { Route as CreateAnimaRoute } from "@/routes/_app/animas.new";
import { Route as AnimaDetailsRoute } from "@/routes/_app/animas/$animaId";

const REASON = hostedExclusionReasons.anima_creation;

const fixture = vi.hoisted(() => ({
  capabilities: undefined as { anima_creation: boolean } | undefined,
  loading: false,
  detailsProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    data: fixture.capabilities,
    isLoading: fixture.loading,
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  Outlet: () => null,
  useLocation: () => "/",
  useNavigate: () => vi.fn(),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => ({ avatar: undefined, tab: "overview" }),
    useParams: () => ({ animaId: "annie" }),
  }),
}));
vi.mock("@/ui/components/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/ui/sidebar/Sidebar", () => ({
  SidebarLink: () => null,
  useCloseMobileSidebar: () => () => {},
}));
vi.mock("@/ui/app/AppShellPage", () => ({
  AppShellPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/ui/create-anima/CreateAnimaPage", () => ({
  CreateAnimaPage: () => <p>Anima creator</p>,
}));
vi.mock("@/ui/animas/AnimaDetailsPage", () => ({
  AnimaDetailsPage: (props: Record<string, unknown>) => {
    fixture.detailsProps = props;
    return null;
  },
}));
vi.mock("@/ui/content-preview/ContentPreviewDockProvider", () => ({
  ContentPreviewExclusiveCanvasGate: ({
    children,
  }: {
    children: ReactNode;
  }) => <>{children}</>,
}));
vi.mock("@/query/hooks/useAnimaPresentationImage", () => ({
  useAnimaPresentationImage: () => ({ data: null }),
}));

function renderRoute(route: { options: { component?: unknown } }) {
  return renderToStaticMarkup(
    createElement(route.options.component as () => ReactNode),
  );
}

function renderCarousel(
  onCreate?: () => void,
  createUnavailableReason?: string,
) {
  return renderToStaticMarkup(
    <AnimaCarousel
      animas={[]}
      selectedAnimaId={null}
      onSelect={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onCreate={onCreate}
      createUnavailableReason={createUnavailableReason}
    />,
  );
}

/** The opening tag of the element whose markup contains `marker`. */
function elementWith(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

/** An entry point that stays visible but inert, described by the shared reason. */
function expectUnavailable(html: string, marker: string) {
  const control = elementWith(html, marker);
  expect(control).toMatch(/aria-disabled="true"|disabled=""/);
  expect(control).not.toContain("href=");
  const describedBy = control.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(describedBy).toBeTruthy();
  expect(elementWith(html, `id="${describedBy}"`)).toBeTruthy();
  expect(html).toContain(REASON);
}

describe.each([["reported", { anima_creation: true }, false]])(
  "Anima creation when the capability is %s",
  (_label, capabilities, loading) => {
    beforeEach(() => {
      fixture.capabilities = capabilities;
      fixture.loading = loading;
    });

    it("offers every create-Anima entry point", () => {
      const sidebar = renderToStaticMarkup(<SidebarCreateMenu />);
      expect(sidebar).toContain('href="/animas/new"');
      expect(sidebar).not.toContain(REASON);
      const hub = renderToStaticMarkup(<CreateHubPage />);
      expect(hub).toContain('href="/animas/new"');
      expect(hub).not.toContain(REASON);
      renderRoute(AnimaDetailsRoute);
      expect(fixture.detailsProps?.onCreateAnima).toBeTypeOf("function");
      expect(
        fixture.detailsProps?.createAnimaUnavailableReason,
      ).toBeUndefined();
      const preview = renderToStaticMarkup(<PreviewCreateAnimaAction />);
      expect(preview).toContain('href="/animas/new"');
      expect(preview).not.toContain(REASON);
    });
  },
);

describe("the creator route", () => {
  it("mounts the creator once creation is reported", () => {
    fixture.capabilities = { anima_creation: true };
    fixture.loading = false;
    expect(renderRoute(CreateAnimaRoute)).toContain("Anima creator");
  });

  it("waits for the first capabilities response before mounting", () => {
    fixture.capabilities = undefined;
    fixture.loading = true;
    expect(renderRoute(CreateAnimaRoute)).toBe("");
  });
});

describe("Anima creation while capabilities are unknown", () => {
  beforeEach(() => {
    fixture.capabilities = undefined;
    fixture.loading = false;
  });

  it("withholds create entry points without claiming a reason", () => {
    for (const html of [
      renderToStaticMarkup(<SidebarCreateMenu />),
      renderToStaticMarkup(<CreateHubPage />),
      renderToStaticMarkup(<PreviewCreateAnimaAction />),
    ]) {
      expect(html).not.toContain("/animas/new");
      expect(html).not.toContain(REASON);
    }
    expect(renderToStaticMarkup(<CreateHubPage />)).not.toContain(
      "Create Anima",
    );
    renderRoute(AnimaDetailsRoute);
    expect(fixture.detailsProps?.onCreateAnima).toBeUndefined();
    expect(fixture.detailsProps?.createAnimaUnavailableReason).toBeUndefined();
  });
});

describe("Anima creation when the capability is disabled", () => {
  beforeEach(() => {
    fixture.capabilities = { anima_creation: false };
    fixture.loading = false;
  });

  it("keeps the sidebar's Anima item, disabled with the shared reason", () => {
    const sidebar = renderToStaticMarkup(<SidebarCreateMenu />);
    expect(sidebar).not.toContain('href="/animas/new"');
    expect(sidebar).toContain('href="/gestures/new"');
    expectUnavailable(sidebar, 'role="menuitem"');
    expect(elementWith(sidebar, 'role="menuitem"')).toContain(
      'aria-disabled="true"',
    );
  });

  it("keeps the creator hub's Anima card with a disabled action and its reason", () => {
    const hub = renderToStaticMarkup(<CreateHubPage />);
    expect(hub).not.toContain('href="/animas/new"');
    expect(hub).toContain('href="/gestures/new"');
    expect(hub).toContain('id="anima-creator-title"');
    expectUnavailable(hub, "Create Anima");
  });

  it("makes the creator route unavailable instead of mounting it", () => {
    const html = renderRoute(CreateAnimaRoute);
    expect(html).not.toContain("Anima creator");
    expect(html).toContain("Anima creation is not available");
  });

  it("keeps the management carousel's New Anima action, disabled with the reason", () => {
    renderRoute(AnimaDetailsRoute);
    expect(fixture.detailsProps?.onCreateAnima).toBeUndefined();
    expect(fixture.detailsProps?.createAnimaUnavailableReason).toBe(REASON);
    expect(renderCarousel()).not.toContain("New Anima");
    expect(renderCarousel(vi.fn())).toContain("New Anima");
    const carousel = renderCarousel(undefined, REASON);
    expect(carousel).toContain("New Anima");
    expectUnavailable(carousel, 'aria-label="Create Anima"');
  });

  it("keeps the preview's Create Anima recovery action, disabled with the reason", () => {
    const preview = renderToStaticMarkup(<PreviewCreateAnimaAction />);
    expect(preview).toContain("Create Anima");
    expectUnavailable(preview, "Create Anima");
  });
});
