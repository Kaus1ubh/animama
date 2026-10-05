export const TEMPLATE_BASE: string;
export type HostedLazyResource = {
  id: string;
  version: string;
  manifest: string;
  manifest_sha256: string;
  route_prefix: string;
  notices: string[];
};
export function hostedLazyResources(): HostedLazyResource[];
export function finalizeHostedBuild(root: string): {
  resource_prefix: string;
  template_sha256: string;
  notices: string[];
  lazy_resources: HostedLazyResource[];
};
