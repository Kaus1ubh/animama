import type { RuntimeCapabilities } from "@animama/runtime-contracts";

/** Direct navigation and corresponding controls share the six hosted exclusion reasons. */
export const hostedExclusionReasons = {
  anima_creation: "Creating Animas is unavailable in this hosted application.",
  chat_file_uploads:
    "Chat attachments are unavailable in this hosted application.",
  document_processing:
    "Document ingestion and OCR are unavailable in this hosted application.",
  provider_credentials:
    "Provider connections and credentials are managed by the hosted operator.",
  local_filesystem_administration:
    "Local filesystem administration requires the local application.",
  native_features:
    "This action requires the desktop application. Browser fullscreen and supported browser picture-in-picture remain available.",
} as const;

export function unavailableRouteReason(
  pathname: string,
  capabilities: RuntimeCapabilities,
): string | null {
  if (pathname === "/animas/new" && !capabilities.anima_creation)
    return hostedExclusionReasons.anima_creation;
  if (
    /^\/(?:attachments|chat-files)(?:\/|$)/.test(pathname) &&
    !capabilities.chat_file_uploads
  )
    return hostedExclusionReasons.chat_file_uploads;
  if (
    /^\/(?:documents|document-processing)(?:\/|$)/.test(pathname) &&
    !capabilities.user_file_processing.enabled
  )
    return hostedExclusionReasons.document_processing;
  if (
    /^\/(?:providers|api-keys|settings\/connections)(?:\/|$)/.test(pathname) &&
    !capabilities.provider_credentials
  )
    return hostedExclusionReasons.provider_credentials;
  if (
    /^\/(?:local-files|filesystem)(?:\/|$)/.test(pathname) &&
    !capabilities.local_filesystem_administration
  )
    return hostedExclusionReasons.local_filesystem_administration;
  if (pathname.startsWith("/desktop/") && !capabilities.native_features)
    return hostedExclusionReasons.native_features;
  if (pathname === "/setup" && capabilities.runtime_kind === "hosted")
    return "Installation setup belongs to the local application. Your hosted account is prepared by the runtime.";
  return null;
}
