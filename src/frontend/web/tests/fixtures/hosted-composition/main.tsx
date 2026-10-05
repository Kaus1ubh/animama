import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers/AppProviders";
import { AppRouter } from "@/app/router";
import { createHostedComposition } from "@/app/hosted-runtime/hosted-composition";
import { RuntimeController } from "@/app/runtime/runtime-controller";
import { installBrowserSessionResources } from "@/app/runtime/browser-session-resources";
import { saveContentEditRecovery } from "@/lib/content/contentEditRecovery";
import {
  creatorRecoveryRecords,
  writeCreatorRecovery,
  queueCreatorRecovery,
} from "./creator-recovery";
import "@/index.css";

const route = new URL(location.href).searchParams.get("route") ?? "/";
history.replaceState(null, "", route);
const observations = {
  navigations: [] as string[],
  lateData: false,
  requestAborted: false,
  workerStopped: false,
  remoteSignOutCompleted: false,
};
const composition = createHostedComposition({
  baseUrl: location.origin,
  fetch: window.fetch.bind(window),
  navigate: (url) => {
    observations.navigations.push(url);
  },
});
window.fetch = composition.browserFetch;
const controller = new RuntimeController(composition);
const remoteSignOut = composition.accountActions!.signOut;
composition.accountActions!.signOut = async () => {
  await remoteSignOut();
  observations.remoteSignOutCompleted = true;
};
installBrowserSessionResources(window, () => controller.getSnapshot().scope);
Object.assign(window, {
  hostedFixture: {
    observations,
    refresh: () => controller.refresh(),
    signOut: () => controller.signOut(),
    writeCreatorRecovery,
    creatorRecoveryRecords,
    queueCreatorRecovery,
    reauthenticate: async () => {
      composition.accountActions!.signIn();
      await controller.refresh();
    },
    current: () => ({
      status: controller.getSnapshot().admission.status,
      key: controller.getSnapshot().scope?.key,
      privateData: controller
        .getSnapshot()
        .queryClient.getQueryData(["fixture-private"]),
    }),
    startPrivateWork: async () => {
      const { scope, queryClient } = controller.getSnapshot();
      if (!scope) throw new Error("Fixture is not admitted");
      queryClient.setQueryData(["fixture-private"], "old-private-data");
      saveContentEditRecovery({
        schema: "animama/content-edit-recovery/1",
        userId: scope.key,
        family: "fixture",
        documentKey: "draft",
        operationId: "fixture-operation",
        form: { text: "private-draft" },
        updatedAt: "2026-10-05T00:00:00Z",
      });
      const url = URL.createObjectURL(new Blob(["private"]));
      const workerUrl = URL.createObjectURL(
        new Blob(["setInterval(() => postMessage('active'), 25);"], {
          type: "application/javascript",
        }),
      );
      const worker = new Worker(workerUrl);
      const nativeTerminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        observations.workerStopped = true;
        nativeTerminate();
      };
      // This observer records disposal, while the browser adapter independently owns termination.
      scope.register(() => {
        observations.workerStopped = true;
      });
      new Audio(url);
      await navigator.mediaDevices.getUserMedia({ audio: true });
      void scope
        .fetch("/v1/fixture-pending")
        .then((response) => response.json())
        .then(() => {
          observations.lateData = true;
        })
        .catch((error) => {
          observations.requestAborted =
            error instanceof DOMException && error.name === "AbortError";
        });
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <AppProviders controller={controller}>
    <AppRouter />
  </AppProviders>,
);
