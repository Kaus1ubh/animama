import { useState } from "react";
import { useDocumentPiP } from "@/hooks/useDocumentPiP";
import { useFullscreen } from "@/hooks/useFullscreen";

/** Actual browser utility hooks; the test controls only the browser window boundary. */
function UtilitySurface({ unmount }: { unmount: () => void }) {
  const [mode, setMode] = useState<"avatar-chat" | "chat" | "avatar">(
    "avatar-chat",
  );
  const pip = useDocumentPiP({ canvasMode: mode, setCanvasMode: setMode });
  const fullscreen = useFullscreen(pip.canvasHostRef);
  return (
    <main>
      <div ref={pip.canvasHostRef} id="utility-private-surface">
        Private companion
      </div>
      <button onClick={() => void pip.togglePip()}>Open browser PiP</button>
      <button onClick={pip.closePip}>Close browser PiP</button>
      <button onClick={fullscreen.enterFullscreen}>
        Enter browser fullscreen
      </button>
      <button onClick={fullscreen.exitFullscreen}>
        Exit browser fullscreen
      </button>
      <button onClick={unmount}>Leave companion route</button>
      <output id="utility-pip-state">{String(pip.isPipActive)}</output>
      <output id="utility-fullscreen-state">
        {String(fullscreen.isFullscreen)}
      </output>
    </main>
  );
}

export function BrowserUtilityFixture() {
  const [present, setPresent] = useState(true);
  return present ? (
    <UtilitySurface unmount={() => setPresent(false)} />
  ) : (
    <p>Companion route ended</p>
  );
}
