import {
  session,
  shell,
  systemPreferences,
  type BrowserWindow,
  type MediaAccessPermissionRequest,
  type PermissionCheckHandlerHandlerDetails,
  type Session,
} from "electron";

import {
  isAllowedWebUrl,
  isExternalHttpUrl,
  isInternalFallbackUrl,
} from "../utils/url-utils.js";
import { writeLog } from "../logging.js";

const ALLOWED_MEDIA_PERMISSIONS = new Set(["media"]);

function isAllowedOrigin(value: string, allowedWebOrigin: string): boolean {
  return Boolean(value) && isAllowedWebUrl(value, allowedWebOrigin);
}

function resolveRequestOrigin(
  webContentsUrl: string,
  details: MediaAccessPermissionRequest,
): string {
  return details.securityOrigin || details.requestingUrl || webContentsUrl;
}

function resolveCheckOrigin(
  requestingOrigin: string,
  details: PermissionCheckHandlerHandlerDetails,
): string {
  return details.securityOrigin || details.requestingUrl || requestingOrigin;
}

function isAudioOnlyMediaRequest(
  details: MediaAccessPermissionRequest,
): boolean {
  const mediaTypes = details.mediaTypes;
  return Boolean(
    mediaTypes && mediaTypes.includes("audio") && !mediaTypes.includes("video"),
  );
}

function isAudioMediaCheck(
  details: PermissionCheckHandlerHandlerDetails,
): boolean {
  return details.mediaType === "audio";
}

async function requestMacMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== "darwin") return true;

  const status = systemPreferences.getMediaAccessStatus("microphone");
  writeLog("info", `macOS microphone access status=${status}`);

  if (status === "granted") return true;
  if (status !== "not-determined") return false;

  const granted = await systemPreferences.askForMediaAccess("microphone");
  writeLog("info", `macOS microphone access requested; granted=${granted}`);
  return granted;
}

function hasMacMicrophoneAccessForPermissionCheck(): boolean {
  if (process.platform !== "darwin") return true;
  return systemPreferences.getMediaAccessStatus("microphone") === "granted";
}

export function installSessionGuards(
  allowedWebOrigin: string,
  targetSession: Session = session.defaultSession,
): void {
  targetSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) => {
      if (!ALLOWED_MEDIA_PERMISSIONS.has(permission)) return false;
      const origin = resolveCheckOrigin(requestingOrigin, details);
      const allowed =
        isAllowedOrigin(origin, allowedWebOrigin) &&
        isAudioMediaCheck(details) &&
        hasMacMicrophoneAccessForPermissionCheck();
      if (!allowed) {
        writeLog(
          "info",
          `Denied media permission check origin=${origin} mediaType=${details.mediaType ?? "unknown"}`,
        );
      }
      return allowed;
    },
  );

  targetSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (!ALLOWED_MEDIA_PERMISSIONS.has(permission)) {
        callback(false);
        return;
      }

      const origin = resolveRequestOrigin(
        webContents.getURL(),
        details as MediaAccessPermissionRequest,
      );
      const allowedByPolicy =
        isAllowedOrigin(origin, allowedWebOrigin) &&
        isAudioOnlyMediaRequest(details as MediaAccessPermissionRequest);

      if (!allowedByPolicy) {
        writeLog(
          "info",
          `Denied media permission request origin=${origin} mediaTypes=${JSON.stringify((details as MediaAccessPermissionRequest).mediaTypes ?? null)}`,
        );
        callback(false);
        return;
      }

      void requestMacMicrophoneAccess()
        .then((granted) => {
          writeLog(
            "info",
            `Media permission request origin=${origin} mediaTypes=${JSON.stringify((details as MediaAccessPermissionRequest).mediaTypes ?? null)} granted=${granted}`,
          );
          callback(granted);
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.stack || error.message
              : String(error);
          writeLog("error", `Failed to request microphone access: ${message}`);
          callback(false);
        });
    },
  );
}

export function installWindowGuards(
  window: BrowserWindow,
  allowedWebOrigin: string,
): void {
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl) => {
      if (isInternalFallbackUrl(validatedUrl)) return;
      writeLog(
        "error",
        `Renderer load failed for ${validatedUrl}: ${errorCode} ${errorDescription}`,
      );
    },
  );

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedWebUrl(url, allowedWebOrigin) || isInternalFallbackUrl(url)) {
      return;
    }
    event.preventDefault();
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}
