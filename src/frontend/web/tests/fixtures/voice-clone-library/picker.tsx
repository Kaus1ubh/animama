import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PocketVoicePicker } from "@/ui/animas/PocketVoicePicker";
import { POCKET_VOICES } from "@/lib/speech/pocket/voice-catalog";
import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";
import "@/index.css";

const actions: { operation: string; id: string }[] = [];

function Fixture() {
  const [states, setStates] = useState<
    Record<string, PocketVoiceAvailability["status"]>
  >({});
  const [selected, setSelected] = useState("eve");
  const setDownloadState = (
    id: string,
    status: PocketVoiceAvailability["status"],
  ) => setStates((current) => ({ ...current, [id]: status }));
  const props = {
    disabled: false,
    downloadBusy: Object.values(states).includes("downloading"),
    availability: (id: string) => {
      const voice = POCKET_VOICES.find((item) => item.id === id);
      return voice?.assetId
        ? {
            assetId: voice.assetId,
            status: states[voice.assetId] ?? "not_installed",
            progress: 0.5,
          }
        : null;
    },
    onDownload: (id: string) => {
      actions.push({ operation: "download", id });
      setDownloadState(id, "downloading");
    },
    onRemove: (id: string) => {
      actions.push({ operation: "cancel", id });
      setDownloadState(id, "not_installed");
    },
  };
  Object.assign(window, {
    voicePickerFixture: { actions, selected, setDownloadState },
  });
  return (
    <div style={{ maxWidth: 500, padding: 20 }}>
      <PocketVoicePicker
        {...props}
        value={selected}
        hasCustomVoice={false}
        onSelect={async (id) => {
          actions.push({ operation: "select", id });
          setSelected(id);
        }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
