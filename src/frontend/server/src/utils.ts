export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

export function readBooleanEnv(...names: string[]): boolean {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    if (value === "1" || value.toLowerCase() === "true") return true;
  }
  return false;
}
