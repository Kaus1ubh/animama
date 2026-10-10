// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getI18n } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";

import { useCrisisProtocol } from "./crisisProtocol";

function Protocol() {
  return <pre>{useCrisisProtocol().split("\n").slice(0, 4).join("\n")}</pre>;
}

let root: Root | null = null;

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  await getI18n().changeLanguage("en");
});

async function settle() {
  for (let attempt = 0; attempt < 20; attempt += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

describe("useCrisisProtocol", () => {
  it("shows the English protocol, and the active locale's translation once loaded", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<Protocol />));
    expect(container.textContent).toContain(
      "Animama safety and crisis protocol",
    );

    await act(() => getI18n().changeLanguage("ja"));
    await settle();
    expect(container.textContent).not.toContain(
      "Animama safety and crisis protocol",
    );
    expect(container.textContent).toMatch(/[぀-ヿ一-鿿]/);
  });
});
