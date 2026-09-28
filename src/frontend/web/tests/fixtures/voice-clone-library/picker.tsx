import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PocketVoicePicker } from "@/ui/animas/PocketVoicePicker";
import { POCKET_VOICES } from "@/lib/speech/pocket/voice-catalog";
import type { PocketVoiceAvailability } from "@/lib/speech/pocket/voice-preferences";
import "@/index.css";

const actions: { operation: string; id: string }[] = [];
const downloadOnly = !new URLSearchParams(location.search).has("selection");

function Fixture() {
  const [states, setStates] = useState<
    Record<string, PocketVoiceAvailability["status"]>
  >({});
  const [selected, setSelected] = useState("eve");
  const props = {
    disabled: false,
    availability: (id: string) => {
      const voice = POCKET_VOICES.find((item) => item.id === id);
      return voice?.assetId
        ? {
            assetId: voice.assetId,
            status: states[voice.assetId] ?? "not_installed",
          }
        : null;
    },
    onDownload: (id: string) => {
      actions.push({ operation: "download", id });
      setStates((current) => ({ ...current, [id]: "installed" }));
    },
    onRemove: (id: string) => {
      actions.push({ operation: "remove", id });
      setStates((current) => ({ ...current, [id]: "not_installed" }));
    },
  };
  Object.assign(window, { voicePickerFixture: { actions, selected } });
  return (
    <div style={{ maxWidth: 500, padding: 20 }}>
      {downloadOnly ? (
        <PocketVoicePicker {...props} downloadOnly />
      ) : (
        <PocketVoicePicker
          {...props}
          value={selected}
          hasCustomVoice={false}
          onSelect={async (id) => {
            actions.push({ operation: "select", id });
            setSelected(id);
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
