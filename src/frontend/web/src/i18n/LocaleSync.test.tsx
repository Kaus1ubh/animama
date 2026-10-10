// @vitest-environment happy-dom
import { StrictMode, act, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { AnimamaI18nProvider } from "@animama/product-ui/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleSync } from "./LocaleSync";
import { createWebI18n } from "./web-i18n";

const settings = vi.hoisted(() => ({ locale: null as string | null }));

vi.mock("@/query/hooks/useUserSettings", () => ({
  useUserSettings: () => ({
    data: { locale: settings.locale },
    isSuccess: true,
  }),
}));

// Memoized so only the i18n subscription, not a parent render, can update it.
const LanguageLabel = memo(function LanguageLabel() {
  const { t } = useTranslation("settings");
  return <span>{t("appearance.language.label")}</span>;
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  delete (window as { animamaDesktop?: unknown }).animamaDesktop;
  window.sessionStorage.clear();
});

/** The desktop preload's bridge as the main app window sees it. */
function stubDesktopMainWindow() {
  const setApplied = vi.fn<(locale: string) => Promise<void>>(
    async () => undefined,
  );
  Object.defineProperty(window, "animamaDesktop", {
    configurable: true,
    value: { isDesktop: true, windowRole: "main", locale: { setApplied } },
  });
  return setApplied;
}

async function mount(i18n: Awaited<ReturnType<typeof createWebI18n>>) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <AnimamaI18nProvider i18n={i18n}>
        <LocaleSync />
      </AnimamaI18nProvider>,
    ),
  );
  await settle();
}

async function settle() {
  // Catalog chunks load asynchronously before the language change is announced.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("LocaleSync", () => {
  it("re-renders mounted text when the saved locale needs a catalog load", async () => {
    settings.locale = null;
    const i18n = await createWebI18n("en");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render = () =>
      root!.render(
        <StrictMode>
          <AnimamaI18nProvider i18n={i18n}>
            <LocaleSync />
            <LanguageLabel />
          </AnimamaI18nProvider>
        </StrictMode>,
      );
    act(render);
    await settle();
    expect(container.textContent).toBe("Language");

    settings.locale = "ja";
    act(render);
    await settle();
    expect(i18n.language).toBe("ja");
    expect(container.textContent).toBe("言語");
    expect(document.documentElement.lang).toBe("ja");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("tells the desktop shell the locale it applied", async () => {
    const setApplied = stubDesktopMainWindow();
    settings.locale = "ko";
    await mount(await createWebI18n("en"));
    expect(setApplied).toHaveBeenLastCalledWith("ko");
  });

  it("never sends the development pseudo-locale to the desktop shell", async () => {
    const setApplied = stubDesktopMainWindow();
    window.sessionStorage.setItem("animama.ui-locale.pseudo", "1");
    settings.locale = "ja";
    await mount(await createWebI18n("en"));
    expect(setApplied).not.toHaveBeenCalled();
  });
});
