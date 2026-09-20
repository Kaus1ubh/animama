import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Theme } from "./theme";

// Exercise the mounted branch so the hydration guard cannot hide a regression.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: () => true,
}));

it("hides theme choices when theme selection is disabled", () => {
  const html = renderToStaticMarkup(<Theme variant="tabs" showLabel />);
  expect(html).toBe("");
});
