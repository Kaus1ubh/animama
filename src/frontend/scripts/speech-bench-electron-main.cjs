// Minimal Electron shell that loads the development speech benchmark page for
// scripts/speech-bench.mjs. It uses the desktop app's Electron build, so ONNX
// Runtime runs on the same Chromium as the packaged renderer.
const { app, BrowserWindow } = require("electron");

// scripts/speech-bench.mjs passes a fresh profile so each run starts without
// the Chromium caches of an earlier run.
if (process.env.SPEECH_BENCH_USER_DATA) {
  app.setPath("userData", process.env.SPEECH_BENCH_USER_DATA);
}

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A measurement must not slow down when the window loses focus.
      backgroundThrottling: false,
    },
  });
  window.loadURL(process.env.SPEECH_BENCH_URL);
});

app.on("window-all-closed", () => app.quit());
