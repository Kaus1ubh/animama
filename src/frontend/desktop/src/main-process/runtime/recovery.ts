import { BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";
import type { RuntimeIpcCallers } from "./ipc.js";

/** No app bundle, provider key, error detail, or backend URL is needed for recovery. */
export function createRuntimePage(): string {
  const nonce = randomBytes(18).toString("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Animama</title>
<style>body{font:16px system-ui,sans-serif;color:#ece8f4;background:#191720;margin:0;display:grid;place-items:center;min-height:100vh}main{max-width:440px;padding:36px}h1{font-size:26px}p{line-height:1.6;color:#c6c0d2}code{font-size:13px;overflow-wrap:anywhere}button{padding:10px 16px;border:1px solid #635c75;border-radius:9px;background:#30293f;color:inherit;cursor:pointer;margin:8px 8px 0 0}button:disabled{opacity:.5}</style></head><body><main><h1>Starting Animama</h1><p id="message" role="status">Preparing your private local runtime…</p><code id="code"></code><p><code id="backup"></code></p><div><button id="retry" hidden>Retry</button><button id="logs">Open Logs</button><button id="backups" hidden>Open Backups</button><button id="quit">Quit</button></div></main>
<script nonce="${nonce}">
const runtime=window.animamaDesktop?.runtime;
const stages={validating:'Checking installed runtime files…',vault:'Unlocking protected settings…',application:'Opening your local application…',database:'Starting your private database…',migrations:'Preparing your local data…',backend:'Starting Animama services…'};
const advice={gateway_port_in_use:'The saved application port is occupied. Close the other application using it and retry. Your data has not changed.',secure_storage_unavailable:'macOS secure storage is unavailable. Unlock your login keychain and retry.',vault_unreadable:'Protected settings could not be unlocked. Restore the matching vault and database backup; do not delete either to reset this error.',vault_missing_for_database:'This database is missing its matching vault. Restore both from your backup.',previous_runtime_running:'A process from an earlier launch is still running. Quit that Animama instance or restart your computer, then retry.',unsupported_postgresql_major:'This database needs a supported upgrade. Your existing data has been preserved.',runtime_manifest_invalid:'The runtime is missing or damaged. Reinstall a complete Animama build; your user data is separate.',runtime_file_invalid:'An installed runtime file is missing or damaged. Reinstall Animama without deleting your data.',unsupported_runtime_platform:'This Animama build needs macOS 15 or later on Apple silicon, or Windows 11 on x64. Your data has not changed.'};
Object.assign(advice,{runtime_busy:'Animama is still finishing local work. The previous configuration is preserved; wait for recovery and retry the change.',runtime_quiesce_failed:'Local work could not be stopped safely. The previous configuration is preserved. Open Logs or restart Animama before retrying.',migration_failed:'The database upgrade failed. The original snapshot is preserved below. Open Logs, fix the cause, and retry this version. Do not reset, downgrade, or restore automatically: that could discard newer data.',pre_migration_backup_failed:'The database snapshot could not be verified. No migration was started. Check disk space and Logs before retrying.',migration_recovery_required:'A previous database upgrade needs attention. Keep its snapshot and the current database. Open Logs and finish that upgrade before trying a different version.',update_install_timeout:'The installer did not finish in time. Services remain stopped for safety. Quit and reopen Animama, or reinstall the signed version. Do not reset your data.',owned_services_stop_failed:'Some Animama services could not stop. Quit again or restart your computer before updating. Your data is preserved.',database_schema_mismatch:'Your local database does not match the structure this version of Animama expects, so startup stopped before using it. Your local data is preserved, and retrying will not change this. For a development build, quit Animama and run pnpm desktop:mac:reset to archive this profile and start fresh. Otherwise, reopen the Animama version that created this data.',content_startup_failed:'Animama could not reconcile its content library, so startup stopped instead of running incomplete. Your local data is preserved. Open Logs for details, then retry. If a development build keeps failing here, quit Animama and run pnpm desktop:mac:reset to archive this profile and start fresh.'});
function render(value){document.querySelector('h1').textContent=value.state==='error'?'Animama needs attention':value.state==='updating'?'Installing update':value.state==='stopping'?'Closing Animama':'Starting Animama';document.querySelector('#message').textContent=value.state==='error'?(advice[value.code]||'Startup could not finish. Open Logs for details, fix the problem, and retry. Your local data has been preserved.'):value.state==='starting'?stages[value.stage]:value.state==='ready'?'Opening your app…':value.state==='updating'?'Local services are stopped. Verifying the downloaded app and restarting…':value.state==='stopping'?'Finishing work and stopping owned services…':'Preparing your private local runtime…';document.querySelector('#code').textContent=value.state==='error'?value.code:'';document.querySelector('#backup').textContent=value.state==='error'&&value.backup?'Snapshot: '+value.backup:'';document.querySelector('#backups').hidden=!(value.state==='error'&&value.backup);document.querySelector('#retry').hidden=value.state!=='error'||['update_install_timeout','owned_services_stop_failed','database_schema_mismatch'].includes(value.code);}
async function invoke(action){try{await runtime[action]();}catch{document.querySelector('#message').textContent='The action could not finish. Open Logs, or quit and reopen Animama after fixing the problem.';}}
for(const [id,action] of [['retry','retry'],['logs','openLogs'],['backups','openBackups'],['quit','quit']])document.getElementById(id).onclick=()=>invoke(action);
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
