const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export function isAllowedWebUrl(
  value: string,
  allowedWebOrigin: string,
): boolean {
  try {
    const url = new URL(value);
    return url.origin === allowedWebOrigin;
  } catch {
    return false;
  }
}

export function isExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return WEB_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function isInternalFallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "data:";
  } catch {
    return false;
  }
}
