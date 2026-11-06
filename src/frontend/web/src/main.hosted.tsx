// First: Zod schemas read this when they are created.
import "./lib/zod-runtime";
import "@fontsource-variable/dm-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initialLocale } from "./i18n/locale-preference";
import { createWebI18n } from "./i18n/web-i18n";
// Product UI's stylesheet comes first so the app's own utilities override it;
// it is CSS only, so loading it here runs no application code.
import "@animama/product-ui/styles.css";
import "./index.css";

// Text renders in the first-paint locale; App settings may switch it once loaded.
// Application modules load only once i18n exists, so code that runs while a
// module loads (such as a store's initial state) can translate.
void createWebI18n(initialLocale()).then(async (i18n) => {
  const [
    { createHostedComposition },
    { RuntimeController },
    { installBrowserSessionResources },
    { AppProviders },
    { AppRouter },
  ] = await Promise.all([
    import("./app/hosted-runtime/hosted-composition"),
    import("./app/runtime/runtime-controller"),
    import("./app/runtime/browser-session-resources"),
    import("./app/providers/AppProviders"),
    import("./app/router"),
  ]);
  const composition = createHostedComposition({
    baseUrl: window.location.origin,
    fetch: window.fetch.bind(window),
    navigate: (url) => window.location.assign(url),
  });
  // Install authority before any component, SDK query, byte load or stream can dispatch.
  window.fetch = composition.browserFetch;
  const controller = new RuntimeController(composition);
  installBrowserSessionResources(window, () => controller.getSnapshot().scope);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders controller={controller} i18n={i18n}>
        <AppRouter />
      </AppProviders>
    </StrictMode>,
  );
});
