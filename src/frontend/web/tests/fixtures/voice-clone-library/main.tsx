import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VoiceCloneLibrary } from "@/ui/animas/VoiceCloneLibrary";
import { observations } from "./boundaries";

// Real form, dialog, effects and mutation lifecycle; this fixture never reaches a backend.
const client = new QueryClient();
const root = createRoot(document.getElementById("root")!);
Object.assign(window, {
  voiceCloneFixture: {
    observations,
    pendingMutations: () => client.isMutating(),
    unmount: () => root.unmount(),
  },
});
root.render(
  <QueryClientProvider client={client}>
    <VoiceCloneLibrary
      disabled={false}
      deleting={null}
      onDeleteClose={() => undefined}
      onBusyChange={(busy) => observations.busy.push(busy)}
    />
  </QueryClientProvider>,
);
