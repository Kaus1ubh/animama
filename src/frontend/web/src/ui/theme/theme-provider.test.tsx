import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "./theme-provider";

const fixture = vi.hoisted(() => ({
  enabled: false,
  props: {} as Record<string, unknown>,
}));
vi.mock("@/lib/feature-flags", () => ({
  featureFlags: {
    get themeSelection() {
      return fixture.enabled;
    },
  },
}));
vi.mock("next-themes", () => ({
  ThemeProvider: (props: Record<string, unknown>) => {
    fixture.props = props;
    return null;
  },
}));

beforeEach(() => {
  fixture.enabled = false;
});

it("forces light before persisted or system preferences can be applied", () => {
  renderToStaticMarkup(<ThemeProvider defaultTheme="dark" enableSystem />);
  expect(fixture.props.forcedTheme).toBe("light");
  expect(fixture.props.enableSystem).toBe(false);
});

it("restores theme selection when the feature is enabled", () => {
  fixture.enabled = true;
  renderToStaticMarkup(<ThemeProvider defaultTheme="dark" enableSystem />);
  expect(fixture.props.forcedTheme).toBeUndefined();
  expect(fixture.props.enableSystem).toBe(true);
});
