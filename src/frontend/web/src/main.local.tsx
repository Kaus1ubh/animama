import "@fontsource-variable/dm-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initialLocale } from "@/i18n/locale-preference";
import { createWebI18n } from "@/i18n/web-i18n";
// Product UI's stylesheet comes first so the app's own utilities override it;
// it is CSS only, so loading it here runs no application code.
import "@animama/product-ui/styles.css";
import "./index.css";

// Keep development profiling cleanup out of all built application artifacts.
if (__ANIMAMA_DEV_BUILD__) {
  void import("@/lib/development/reactPerformanceTiming");
}

// Text renders in the first-paint locale; App settings may switch it once loaded.
// Application modules load only once i18n exists, so code that runs while a
// module loads (such as a store's initial state) can translate.
void createWebI18n(initialLocale()).then(async (i18n) => {
  const [
    { installLocalGatewayFetchInterceptor },
    { createLocalComposition },
    { RuntimeController },
    { installBrowserSessionResources },
    { AppProviders },
    { AppRouter },
  ] = await Promise.all([
    import("@/lib/local-gateway/fetch-interceptor"),
    import("./app/local-runtime/local-composition"),
    import("./app/runtime/runtime-controller"),
    import("./app/runtime/browser-session-resources"),
    import("@/app/providers/AppProviders"),
    import("@/app/router"),
  ]);
  installLocalGatewayFetchInterceptor();
  const controller = new RuntimeController(createLocalComposition());
  installBrowserSessionResources(window, () => controller.getSnapshot().scope);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProviders controller={controller} i18n={i18n}>
        <AppRouter />
      </AppProviders>
    </StrictMode>,
  );
});
