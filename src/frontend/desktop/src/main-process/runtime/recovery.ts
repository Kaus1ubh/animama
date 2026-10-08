import { BrowserWindow, nativeTheme } from "electron";
import { randomBytes } from "node:crypto";
// esbuild inlines both as data URLs (see scripts/build.mjs).
import dmSans from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2";
import mark from "../../../assets/startup-mark.png";
import type { RuntimeIpcCallers } from "./ipc.js";

// The page script runs in the renderer, so main chooses the platform's wording.
const secureStorageAdvice =
  process.platform === "win32"
    ? "Windows protected storage is unavailable for this account. Sign in to Windows with your own account, not a temporary profile, and retry."
    : "macOS secure storage is unavailable. Unlock your login keychain and retry.";
// Development profiles only: macOS has an archiving helper; on Windows the
// data folder is renamed by hand, which keeps everything in it.
const freshProfileAdvice =
  process.platform === "win32"
    ? "quit Animama and rename %LOCALAPPDATA%\\Animama (for example to Animama.backup) to keep this profile and start fresh"
    : "quit Animama and run pnpm desktop:mac:reset to archive this profile and start fresh";

/**
 * Theme tokens the startup page uses, mirrored from product-ui's `theme.css`
 * (light `:root` and `.dark`); a desktop test keeps them in sync. The page is
 * a self-contained data URL, so it cannot load the app's stylesheet.
 */
export const STARTUP_THEME = {
  light: {
    background: "hsl(48 33.3333% 97.0588%)",
    foreground: "hsl(0 0% 20%)",
    muted: "hsl(50.2 27.4% 87.1%)",
    "muted-foreground": "hsl(0 0% 43.1373%)",
    primary: "hsl(197.4 71.4286% 72.549%)",
    "primary-foreground": "hsl(0 0% 0%)",
    accent: "hsl(78 91.6667% 76.4706%)",
    "accent-foreground": "hsl(0 0% 0%)",
    border: "hsl(0 0% 83.1373%)",
    ring: "hsl(349.5238 100% 87.6471%)",
  },
  dark: {
    background: "hsl(220 14.7541% 11.9608%)",
    foreground: "hsl(0 0% 89.8039%)",
    muted: "hsl(0 0% 26.6667%)",
    "muted-foreground": "hsl(0 0% 63.9216%)",
    primary: "hsl(330 100% 80%)",
    "primary-foreground": "hsl(0 0% 0%)",
    accent: "hsl(78 91.6667% 76.4706%)",
    "accent-foreground": "hsl(0 0% 0%)",
    border: "hsl(0 0% 26.6667%)",
    ring: "hsl(330 100% 80%)",
  },
} as const;

/** The page background as hex, so the window paints it before the page loads. */
export const STARTUP_BACKGROUND = { light: "#faf9f5", dark: "#1a1d23" };

const tokens = (theme: Record<string, string>) =>
  Object.entries(theme)
    .map(([name, value]) => `--${name}:${value}`)
    .join(";");

// Mirrors the app's 18px root, DM Sans and shadcn Button variants.
const styles = `@font-face{font-family:"DM Sans Variable";font-style:normal;font-display:block;font-weight:100 1000;src:url(${dmSans}) format("woff2")}
:root{color-scheme:light dark;--radius:0.5rem;${tokens(STARTUP_THEME.light)}}
@media (prefers-color-scheme:dark){:root{${tokens(STARTUP_THEME.dark)}}}
html{font-size:18px}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--background);color:var(--foreground);font-family:"DM Sans Variable",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none}
main{box-sizing:border-box;width:100%;max-width:28rem;padding:2rem 1.5rem;display:flex;flex-direction:column;align-items:center;text-align:center}
.mark{width:4rem;height:4rem}
h1{margin:1rem 0 0;font-size:1.25rem;line-height:1.75rem;font-weight:600}
p{margin:.375rem 0 0;font-size:.875rem;line-height:1.25rem;color:var(--muted-foreground)}
body[data-state=error] #message{color:var(--foreground)}
.bar{width:10rem;height:.25rem;margin-top:1.25rem;border-radius:9999px;background:var(--muted);overflow:hidden}
.bar span{display:block;width:40%;height:100%;border-radius:inherit;background:var(--primary);animation:slide 1.4s ease-in-out infinite}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.bar span{animation:none;width:100%;opacity:.6}}
.detail{margin-top:.75rem;font:.75rem/1rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted-foreground);overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem;margin-top:1.5rem}
button{font:inherit;font-size:.875rem;font-weight:500;height:2.25rem;padding:0 1rem;border-radius:calc(var(--radius) - 2px);border:1px solid transparent;background:transparent;color:var(--foreground);cursor:pointer;transition:background-color .15s,color .15s}
button.primary{background:var(--primary);color:var(--primary-foreground)}
button.primary:hover{background:color-mix(in oklab,var(--primary) 90%,transparent)}
button.outline{border-color:var(--border);background:var(--background)}
button.outline:hover,button.ghost:hover{background:var(--accent);color:var(--accent-foreground)}
button:focus-visible{outline:2px solid var(--foreground);outline-offset:2px}
button:disabled{opacity:.5;pointer-events:none}
[hidden]{display:none!important}`;

/**
 * The desktop startup and recovery page: the logo, one status line and a
 * progress bar while local services start; the error advice with Retry,
 * Open Logs, Open Backups and Quit when startup fails. Open Logs and Quit
 * also appear when startup takes unusually long. No app bundle, provider key,
 * error detail, or backend URL is needed.
 */
export function createRuntimePage(): string {
  const nonce = randomBytes(18).toString("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Animama</title>
<style>${styles}</style></head><body data-state="starting"><main><img class="mark" src="${mark}" alt=""><h1 id="title">Animama</h1><p id="message" role="status">Preparing your private local runtime…</p><div class="bar" id="bar" aria-hidden="true"><span></span></div><p class="detail" id="detail" hidden><span id="code"></span><br><span id="backup"></span></p><div class="actions" id="actions" hidden><button id="retry" class="primary" hidden>Retry</button><button id="logs" class="outline">Open Logs</button><button id="backups" class="outline" hidden>Open Backups</button><button id="quit" class="ghost">Quit</button></div></main>
<script nonce="${nonce}">
const runtime=window.animamaDesktop?.runtime;
const $=(id)=>document.getElementById(id);
const stages={validating:'Checking installed runtime files…',vault:'Unlocking protected settings…',application:'Opening your local application…',database:'Starting your private database…',migrations:'Preparing your local data…',backend:'Starting Animama services…'};
const advice={gateway_port_in_use:'The saved application port is occupied. Close the other application using it and retry. Your data has not changed.',secure_storage_unavailable:${JSON.stringify(secureStorageAdvice)},data_path_too_long:'Your Windows profile folder path is too long for Animama data. Use a Windows account whose profile path is shorter, then reopen Animama.',administrator_launch_unsupported:'Animama cannot run its private database with administrator rights. Quit, then open Animama normally instead of with Run as administrator. Your data has not changed.',vault_unreadable:'Protected settings could not be unlocked. Restore the matching vault and database backup; do not delete either to reset this error.',vault_missing_for_database:'This database is missing its matching vault. Restore both from your backup.',previous_runtime_running:'A process from an earlier launch is still running. Wait a few seconds and retry. If this continues, quit that Animama instance or restart your computer.',unsupported_postgresql_major:'This database needs a supported upgrade. Your existing data has been preserved.',runtime_manifest_invalid:'The runtime is missing or damaged. Reinstall a complete Animama build; your user data is separate.',runtime_file_invalid:'An installed runtime file is missing or damaged. Reinstall Animama without deleting your data.',unsupported_runtime_platform:'This Animama build needs macOS 15 or later on Apple silicon, or Windows 11 on x64. Your data has not changed.'};
Object.assign(advice,{runtime_busy:'Animama is still finishing local work. The previous configuration is preserved; wait for recovery and retry the change.',runtime_quiesce_failed:'Local work could not be stopped safely. The previous configuration is preserved. Open Logs or restart Animama before retrying.',migration_failed:'The database upgrade failed. The original snapshot is preserved below. Open Logs, fix the cause, and retry this version. Do not reset, downgrade, or restore automatically: that could discard newer data.',pre_migration_backup_failed:'The database snapshot could not be verified. No migration was started. Check disk space and Logs before retrying.',migration_recovery_required:'A previous database upgrade needs attention. Keep its snapshot and the current database. Open Logs and finish that upgrade before trying a different version.',update_install_timeout:'The installer did not finish in time. Services remain stopped for safety. Quit and reopen Animama, or reinstall the signed version. Do not reset your data.',owned_services_stop_failed:'Some Animama services could not stop. Quit again or restart your computer before updating. Your data is preserved.',database_schema_mismatch:${JSON.stringify(`Your local database does not match the structure this version of Animama expects, so startup stopped before using it. Your local data is preserved, and retrying will not change this. For a development build, ${freshProfileAdvice}. Otherwise, reopen the Animama version that created this data.`)},content_startup_failed:${JSON.stringify(`Animama could not reconcile its content library, so startup stopped instead of running incomplete. Your local data is preserved. Open Logs for details, then retry. If a development build keeps failing here, ${freshProfileAdvice}.`)}});
const noRetry=['update_install_timeout','owned_services_stop_failed','database_schema_mismatch','data_path_too_long','administrator_launch_unsupported'];
// Startup normally finishes well within this; past it, offer Logs and Quit.
const STALL_MS=20000;
let state='starting',stalled=false,stallTimer;
// Each start (first launch, a restart or Retry) gets its own stall window.
function watchStall(){clearTimeout(stallTimer);stalled=false;stallTimer=setTimeout(()=>{stalled=true;if(state==='starting')$('actions').hidden=false;},STALL_MS);}
watchStall();
function render(value){if(value.state==='starting'&&state!=='starting')watchStall();state=value.state;const error=value.state==='error';document.body.dataset.state=value.state;$('title').textContent=error?'Animama needs attention':value.state==='updating'?'Installing update':value.state==='stopping'?'Closing Animama':'Animama';$('message').textContent=error?(advice[value.code]||'Startup could not finish. Open Logs for details, fix the problem, and retry. Your local data has been preserved.'):value.state==='starting'?stages[value.stage]:value.state==='ready'?'Opening your app…':value.state==='updating'?'Local services are stopped. Verifying the downloaded app and restarting…':value.state==='stopping'?'Finishing work and stopping owned services…':'Preparing your private local runtime…';$('bar').hidden=error;$('code').textContent=error?value.code:'';$('backup').textContent=error&&value.backup?'Snapshot: '+value.backup:'';$('detail').hidden=!error;$('backups').hidden=!(error&&value.backup);$('retry').hidden=!error||noRetry.includes(value.code);$('actions').hidden=!(error||(stalled&&value.state==='starting'));}
async function invoke(action){try{await runtime[action]();}catch{$('message').textContent='The action could not finish. Open Logs, or quit and reopen Animama after fixing the problem.';$('actions').hidden=false;}}
for(const [id,action] of [['retry','retry'],['logs','openLogs'],['backups','openBackups'],['quit','quit']])$(id).onclick=()=>invoke(action);
if(runtime){runtime.onStatus(render);runtime.status().then(render).catch(()=>{});}
</script></body></html>`;
}

/** Independent data URL works when the application listener is unavailable. */
export async function createRecoveryWindow(
  preload: string,
  html: string,
  callers: RuntimeIpcCallers,
): Promise<BrowserWindow> {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    title: "Animama",
    backgroundColor: nativeTheme.shouldUseDarkColors
      ? STARTUP_BACKGROUND.dark
      : STARTUP_BACKGROUND.light,
    webPreferences: {
      preload,
      additionalArguments: ["--animama-window-role=recovery"],
      partition: "animama-recovery",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  callers.register(window, "recovery", url);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL(url);
  return window;
}
