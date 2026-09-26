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

const DIAL_PROTOCOLS = new Set(["tel:", "sms:"]);

/**
 * Crisis-card call and text links: `tel:`/`sms:` with only digits and an
 * optional leading `+`, handed to the operating system (companion safety R4).
 */
export function isPhoneOrSmsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      DIAL_PROTOCOLS.has(url.protocol) &&
      url.href === `${url.protocol}${url.pathname}` &&
      /^\+?\d{2,20}$/u.test(url.pathname)
    );
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
