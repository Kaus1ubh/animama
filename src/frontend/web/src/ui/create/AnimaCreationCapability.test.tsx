import { readFile } from "node:fs/promises";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnimaCarousel } from "@/ui/animas/AnimaCarousel";
import { CreateHubPage } from "@/ui/create/CreateHubPage";
import { SidebarCreateMenu } from "@/ui/sidebar/SidebarCreateMenu";
import { Route as CreateAnimaRoute } from "@/routes/_app/animas.new";
import { Route as AnimaDetailsRoute } from "@/routes/_app/animas/$animaId";

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

function renderCarousel(onCreate?: () => void) {
  return renderToStaticMarkup(
    <AnimaCarousel
      animas={[]}
      selectedAnimaId={null}
      onSelect={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onCreate={onCreate}
    />,
  );
}

describe.each([
  ["reported", { anima_creation: true }, false],
  ["still loading", undefined, true],
])(
  "Anima creation when the capability is %s",
  (_label, capabilities, loading) => {
    beforeEach(() => {
      fixture.capabilities = capabilities;
      fixture.loading = loading;
    });

    it("offers every create-Anima entry point", () => {
      expect(renderToStaticMarkup(<SidebarCreateMenu />)).toContain(
        'href="/animas/new"',
      );
      expect(renderToStaticMarkup(<CreateHubPage />)).toContain(
        'href="/animas/new"',
      );
      renderRoute(AnimaDetailsRoute);
      expect(fixture.detailsProps?.onCreateAnima).toBeTypeOf("function");
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

describe("Anima creation when the capability is disabled", () => {
  beforeEach(() => {
    fixture.capabilities = { anima_creation: false };
    fixture.loading = false;
  });

  it("hides the sidebar and creator hub entry points", () => {
    const sidebar = renderToStaticMarkup(<SidebarCreateMenu />);
    expect(sidebar).not.toContain('href="/animas/new"');
    expect(sidebar).toContain('href="/gestures/new"');
    const hub = renderToStaticMarkup(<CreateHubPage />);
    expect(hub).not.toContain('href="/animas/new"');
    expect(hub).toContain('href="/gestures/new"');
  });

  it("makes the creator route unavailable instead of mounting it", () => {
    const html = renderRoute(CreateAnimaRoute);
    expect(html).not.toContain("Anima creator");
    expect(html).toContain("Anima creation is not available");
  });

  it("removes the management carousel's New Anima action", () => {
    renderRoute(AnimaDetailsRoute);
    expect(fixture.detailsProps?.onCreateAnima).toBeUndefined();
    expect(renderCarousel()).not.toContain("New Anima");
    expect(renderCarousel(vi.fn())).toContain("New Anima");
  });

  it.each([
    "../library/LibraryContentInventory.tsx",
    "../content-preview/ContentPreviewHost.tsx",
  ])("gates the deep create link in %s", async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    expect(source).toMatch(
      /<RuntimeFeatureGate capability="anima_creation">\s*(<ActionTooltip label="Create Anima"|<Button asChild[^>]*>\s*<Link to="\/animas\/new">)/,
    );
  });
});
