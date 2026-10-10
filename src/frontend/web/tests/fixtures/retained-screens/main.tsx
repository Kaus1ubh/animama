import { installLocalGatewayFetchInterceptor } from "@/lib/local-gateway/fetch-interceptor";
import { createLocalComposition } from "@/app/local-runtime/local-composition";
import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers/AppProviders";
import { createWebI18n } from "@/i18n/web-i18n";
import { AppRouter } from "@/app/router";
import { createHostedComposition } from "@/app/hosted-runtime/hosted-composition";
import { RuntimeController } from "@/app/runtime/runtime-controller";
import "@/index.css";

// Mount the real router, App Settings modal and Library; only HTTP authority is a fixture.
const params = new URLSearchParams(location.search);
const local = params.get("local") === "1";
const route = params.get("route") ?? "/library";
history.replaceState(null, "", route);
const hosted = createHostedComposition({
  baseUrl: location.origin,
  fetch: fetch.bind(window),
  navigate: (url) => location.assign(url),
});
if (local) installLocalGatewayFetchInterceptor();
const composition = local ? createLocalComposition() : hosted;
if (!local) window.fetch = hosted.browserFetch;
const controller = new RuntimeController(composition);
Object.assign(window, {
  retainedScreenFixture: {
    omitUploadPermission() {
      controller
        .getSnapshot()
        .queryClient.setQueriesData(
          { queryKey: ["runtime-capabilities"] },
          (value: unknown) => ({
            ...(value as Record<string, unknown>),
            chat_file_uploads: undefined,
          }),
        );
    },
    async refreshCapabilities() {
      await controller.refresh();
      await controller.getSnapshot().queryClient.invalidateQueries();
    },
  },
});
// Fixtures render in English, like the browser journeys.
const i18n = await createWebI18n("en");
createRoot(document.getElementById("root")!).render(
  <AppProviders controller={controller} i18n={i18n}>
    <AppRouter />
  </AppProviders>,
);
