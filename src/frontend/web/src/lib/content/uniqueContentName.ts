/** Find a readable unused name without characters forbidden in content filenames. */
export function createUniqueContentName(
  baseName: string,
  existingNames: readonly string[],
): string {
  const used = new Set(
    existingNames.map((name) => name.trim().toLocaleLowerCase()),
  );
  const base = baseName.trim();
  if (!used.has(base.toLocaleLowerCase())) return base;
  let suffix = 1;
  while (used.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

/** Continue a branch's numbering, accepting legacy parenthesized source names. */
export function createUniqueContentBranchName(
  sourceName: string,
  existingNames: readonly string[],
): string {
  const source = sourceName.trim();
  const numbered = /^(.*?)\s+(?:\((\d+)\)|(\d+))$/.exec(source);
  const base = numbered?.[1] ?? source;
  let suffix = numbered ? Number(numbered[2] ?? numbered[3]) + 1 : 1;
  const used = new Set(
    existingNames.map((name) => name.trim().toLocaleLowerCase()),
  );
  while (used.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}
