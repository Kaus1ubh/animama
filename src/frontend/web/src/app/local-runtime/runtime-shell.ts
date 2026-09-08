import type { LocalRuntimeState } from "@web/app/local-runtime/LocalRuntimeProvider";

export type LocalRuntimeShellView =
  | "router"
  | "main-loading"
  | "main-error"
  | "auxiliary-wait";

/** Keep auxiliary desktop windows blank until the local runtime is ready. */
export function localRuntimeShellView(
  status: LocalRuntimeState["status"],
  isDesktopAuxiliaryWindow: boolean,
): LocalRuntimeShellView {
  if (status === "ready") return "router";
  if (isDesktopAuxiliaryWindow) return "auxiliary-wait";
  return status === "loading" ? "main-loading" : "main-error";
}
