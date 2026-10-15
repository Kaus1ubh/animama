import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers/AppProviders";
import { getI18n } from "react-i18next";
import { AppRouter } from "@/app/router";
import { createHostedComposition } from "@/app/hosted-runtime/hosted-composition";
import { RuntimeController } from "@/app/runtime/runtime-controller";
import { installBrowserSessionResources } from "@/app/runtime/browser-session-resources";
import { actionRecoveryKey } from "@/lib/content/actionRecovery";
import { recoverySessionIsActive } from "@/lib/content/recovery-session";
import { transcribeClientParakeetWindow } from "@/lib/speech/client-parakeet/client";
import { predictSmartTurn } from "@/lib/voice/smart-turn-worker-client";
import {
  creatorRecoveryRecords,
  writeCreatorRecovery,
  queueCreatorRecovery,
} from "./creator-recovery";
import "@/index.css";
import { BrowserUtilityFixture } from "./utilities";
import { HostedWorkflowObserver } from "./workflows";

type FixtureDraft = { operationId: string; form: Record<string, unknown> };

/** A private per-session draft, stored like an Action editor recovery record. */
function saveFixtureDraft(sessionKey: string, draft: FixtureDraft): void {
  if (!recoverySessionIsActive(sessionKey)) return;
  window.localStorage.setItem(
    actionRecoveryKey(sessionKey, "gesture", "fixture-draft"),
    JSON.stringify(draft),
  );
}

function loadFixtureDraft(sessionKey: string): FixtureDraft | null {
  const raw = window.localStorage.getItem(
    actionRecoveryKey(sessionKey, "gesture", "fixture-draft"),
  );
  return raw ? (JSON.parse(raw) as FixtureDraft) : null;
}

const route = new URL(location.href).searchParams.get("route") ?? "/";
const utilities = new URL(location.href).searchParams.has("utilities");
const workflows = new URL(location.href).searchParams.has("workflows");
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
    persistDraft: (operationId: string, form: Record<string, unknown>) =>
      saveFixtureDraft(controller.getSnapshot().scope!.key, {
        operationId,
        form,
      }),
    draft: () => loadFixtureDraft(controller.getSnapshot().scope!.key),
    mutate: () =>
      controller.getSnapshot().scope!.fetch("/v1/chats", { method: "POST" }),
    reauthenticate: async () => {
      composition.accountActions!.signIn();
      await controller.refresh();
    },
    /** Asks both speech workers for work they cannot do before loading; a live worker answers. */
    speechProbe: async () => {
      const answer = (work: Promise<unknown>) =>
        Promise.race([
          work.then(
            () => "answered",
            (error: unknown) =>
              error instanceof Error ? error.message : String(error),
          ),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("no reply"), 20_000),
          ),
        ]);
      const audio = () => new Float32Array(1_600);
      return {
        parakeet: await answer(
          transcribeClientParakeetWindow({
            jobId: "probe",
            runId: "probe",
            turnId: "probe",
            windowId: "probe",
            audio: audio(),
          }),
        ),
        smartTurn: await answer(
          predictSmartTurn({
            jobId: "probe",
            turnId: "probe",
            audio: audio(),
            sampleRateHz: 16_000,
            threshold: 0.5,
          }),
        ),
      };
    },
    current: () => ({
      status: controller.getSnapshot().admission.status,
      reconnecting: controller.getSnapshot().reconnecting,
      key: controller.getSnapshot().scope?.key,
      privateData: controller
        .getSnapshot()
        .queryClient.getQueryData(["fixture-private"]),
    }),
    startPrivateWork: async () => {
      const { scope, queryClient } = controller.getSnapshot();
      if (!scope) throw new Error("Fixture is not admitted");
      queryClient.setQueryData(["fixture-private"], "old-private-data");
      saveFixtureDraft(scope.key, {
        operationId: "fixture-operation",
        form: { text: "private-draft" },
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
// `main.tsx` set up English i18n before this module loaded.
const i18n = getI18n();
createRoot(document.getElementById("root")!).render(
  <AppProviders controller={controller} i18n={i18n}>
    {utilities ? <BrowserUtilityFixture /> : <AppRouter />}
    {workflows ? <HostedWorkflowObserver /> : null}
  </AppProviders>,
);
