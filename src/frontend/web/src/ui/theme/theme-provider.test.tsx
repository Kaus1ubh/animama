import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ThemeProvider } from "./theme-provider";

const fixture = vi.hoisted(() => ({
  props: {} as Record<string, unknown>,
}));
vi.mock("next-themes", () => ({
  ThemeProvider: (props: Record<string, unknown>) => {
    fixture.props = props;
    return null;
  },
}));

it("offers light, dark and system modes on the root class, defaulting to light", () => {
  renderToStaticMarkup(<ThemeProvider />);
  expect(fixture.props.attribute).toBe("class");
  expect(fixture.props.themes).toEqual(["light", "dark"]);
  expect(fixture.props.enableSystem).toBe(true);
  expect(fixture.props.defaultTheme).toBe("light");
  expect(fixture.props.forcedTheme).toBeUndefined();
});
