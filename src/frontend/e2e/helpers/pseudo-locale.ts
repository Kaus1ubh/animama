import type { Locator, Page, Response } from "playwright/test";
import { expect } from "playwright/test";

import type { EvidenceAttachment } from "../fixtures/animama";

import {
  localeNativeName,
  SUPPORTED_LOCALES,
} from "@animama/runtime-contracts/locale";
import {
  PSEUDO_CLOSE,
  PSEUDO_LOCALE,
  PSEUDO_OPEN,
  pseudoLocalize,
} from "../../packages/product-ui/src/i18n/pseudo.ts";

export { pseudoLocalize };

/** One visible text node, or a visible placeholder, as collected in the browser. */
export type VisibleText = {
  kind: "text" | "placeholder";
  text: string;
  /**
   * True when a marker-free node sits inside one pseudo string split across
   * elements, such as `<Trans>` output: `⟦Read <b>this</b> first⟧`.
   */
  enclosed: boolean;
  /** Short ancestor path used only to locate the node in a report. */
  context: string;
};

/** A visible text node whose letters carry no pseudo marker and match no exclusion. */
export type UntranslatedText = {
  surface: string;
  kind: VisibleText["kind"];
  text: string;
  unmarked: string;
  context: string;
};

/** Visible text that is not interface wording and so stays as written. */
export type TextExclusions = {
  /** Data the page loaded: content, Anima and chat text, model and voice names. */
  dataStrings: Iterable<string>;
  /**
   * Identifiers the page shows reformatted, such as an Avatar's custom
   * expression `Fcl_ALL_Angry` shown as "Fcl ALL Angry"; matched by
   * {@link identifierKey}.
   */
  identifiers?: Iterable<string>;
  /** Fixed words, such as the product names and each locale's own name. */
  words: Iterable<string>;
};

/**
 * Words shown as written in every locale: the product names (spec P2), each
 * locale's own name in the language picker (spec R1), third-party engine names
 * and the X, Y and Z axis labels.
 */
export const FIXED_WORDS: readonly string[] = [
  "Animama",
  "Anima",
  ...SUPPORTED_LOCALES.map((locale) => localeNativeName(locale)),
  "ElevenLabs",
  "Parakeet",
  "PocketTTS",
  "X",
  "Y",
  "Z",
];

/** File names and hex colours are data by their shape. */
const DATA_SHAPES: readonly RegExp[] = [
  /[\p{L}\p{N}_.-]+\.(?:png|jpe?g|webp|gif|svg|vrma?|glb|gltf|fbx|bvh|json|zip|wav|mp3|ogg|m4a|flac|webm|mp4|md|txt|csv)(?![\p{L}\p{N}])/giu,
  /#[0-9a-f]{3,8}(?![\p{L}\p{N}])/giu,
];

/**
 * Lowercase parts joined by `-` or `_`. Such a value is an identifier, like
 * `emitter-1` or `idea_bulb`, when it has a digit or an underscore; hyphenated
 * words such as "built-in" stay interface text.
 */
const JOINED_LOWERCASE =
  /(?<![\p{L}\p{N}_-])[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+(?![\p{L}\p{N}_-])/gu;

/** Unit symbols allowed next to a number, such as `120 px` or `1.5x`. */
const MEASUREMENT_UNITS = new Set([
  "px",
  "ms",
  "s",
  "fps",
  "hz",
  "khz",
  "db",
  "deg",
  "x",
  "b",
  "kb",
  "mb",
  "gb",
]);

/** JSON keys whose strings are backend prose, which the UI must word itself (R10). */
const PROSE_KEYS = new Set(["message", "detail", "error", "hint"]);

const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The part of one text node outside pseudo markers. A close marker with no
 * opener before it ends a string that started in an earlier node, and an
 * opener without a close continues into a later node; both parts are marked.
 */
export function unmarkedText(text: string): string {
  const firstOpen = text.indexOf(PSEUDO_OPEN);
  const firstClose = text.indexOf(PSEUDO_CLOSE);
  const start =
    firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)
      ? firstClose + PSEUDO_CLOSE.length
      : 0;
  let depth = 0;
  let unmarked = "";
  for (const character of text.slice(start)) {
    if (character === PSEUDO_OPEN) depth += 1;
    else if (character === PSEUDO_CLOSE) depth = Math.max(0, depth - 1);
    else if (depth === 0) unmarked += character;
  }
  return unmarked;
}

/** Remove whole-word occurrences of `value` from `text`. */
function removeWholeOccurrences(text: string, value: string): string {
  let result = text;
  let from = 0;
  for (;;) {
    const index = result.indexOf(value, from);
    if (index === -1) return result;
    const before = result[index - 1];
    const after = result[index + value.length];
    const bounded =
      (before === undefined || !LETTER_OR_DIGIT.test(before)) &&
      (after === undefined || !LETTER_OR_DIGIT.test(after));
    if (bounded) {
      result = `${result.slice(0, index)} ${result.slice(index + value.length)}`;
      from = index + 1;
    } else {
      from = index + value.length;
    }
  }
}

/** Exclusions normalized once per surface by {@link prepareExclusions}. */
export type PreparedExclusions = {
  /** Trimmed, letter-bearing data strings. */
  data: ReadonlySet<string>;
  /** The same strings, longest first. */
  dataByLength: readonly string[];
  /** {@link identifierKey} of each identifier. */
  identifiers: ReadonlySet<string>;
  words: ReadonlySet<string>;
};

/** Compare identifiers by their letters and digits only, ignoring case. */
export function identifierKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Normalize exclusions: trimmed, letter-bearing data strings, longest first. */
export function prepareExclusions(
  exclusions: TextExclusions,
): PreparedExclusions {
  const data = new Set<string>();
  for (const value of exclusions.dataStrings) {
    const trimmed = value.trim();
    if (LETTER.test(trimmed)) data.add(trimmed);
  }
  return {
    data,
    dataByLength: [...data].sort((left, right) => right.length - left.length),
    identifiers: new Set(
      [...(exclusions.identifiers ?? [])].map(identifierKey).filter(Boolean),
    ),
    words: new Set(exclusions.words),
  };
}

/**
 * Expression names that a VRM or VRMA (glTF binary) defines itself: custom
 * expressions and morph target names, which the app also offers as
 * expressions. They are the Avatar author's data. Preset expressions
 * (`happy`, `blinkLeft`, `aa`…) are not returned: like humanoid bone names,
 * they are a fixed vocabulary the interface words itself.
 */
export function customExpressionNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 20 || ascii(0) !== "glTF" || ascii(16) !== "JSON")
    return [];
  const length = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as {
    meshes?: Array<{ extras?: { targetNames?: unknown } }>;
    extensions?: {
      VRMC_vrm?: { expressions?: { custom?: Record<string, unknown> } };
      VRMC_vrm_animation?: {
        expressions?: { custom?: Record<string, unknown> };
      };
      VRM?: {
        blendShapeMaster?: {
          blendShapeGroups?: Array<{ name?: unknown; presetName?: unknown }>;
        };
      };
    };
  };
  const extensions = json.extensions ?? {};
  const vrm0Custom = (
    extensions.VRM?.blendShapeMaster?.blendShapeGroups ?? []
  ).flatMap((group) =>
    typeof group.name === "string" &&
    (!group.presetName || group.presetName === "unknown")
      ? [group.name]
      : [],
  );
  const morphTargets = (json.meshes ?? []).flatMap((mesh) => {
    const names = mesh.extras?.targetNames;
    return Array.isArray(names)
      ? names.filter((name): name is string => typeof name === "string")
      : [];
  });
  return [
    ...morphTargets,
    ...Object.keys(extensions.VRMC_vrm?.expressions?.custom ?? {}),
    ...Object.keys(extensions.VRMC_vrm_animation?.expressions?.custom ?? {}),
    ...vrm0Custom,
  ];
}

/**
 * Return the words of unmarked text left after removing data strings, data
 * shapes, fixed words and units that follow a number; empty means allowed.
 */
export function unexcludedText(
  unmarked: string,
  exclusions: PreparedExclusions,
): string {
  if (
    !LETTER.test(unmarked) ||
    exclusions.data.has(unmarked.trim()) ||
    exclusions.identifiers.has(identifierKey(unmarked))
  )
    return "";
  // Shapes before partial data matches, so a data string such as "Star"
  // cannot split the file name "flare-star.png".
  let remaining = unmarked;
  for (const shape of DATA_SHAPES) remaining = remaining.replace(shape, " ");
  remaining = remaining.replace(JOINED_LOWERCASE, (match) =>
    /[\d_]/.test(match) ? " " : match,
  );
  // Longest first, so "Annie Classic" is removed before "Annie".
  for (const value of exclusions.dataByLength) {
    if (!LETTER.test(remaining)) return "";
    if (remaining.includes(value))
      remaining = removeWholeOccurrences(remaining, value);
  }
  const measured = /\p{N}/u.test(remaining);
  return (remaining.match(/[\p{L}\p{M}]+/gu) ?? [])
    .filter(
      (word) =>
        !exclusions.words.has(word) &&
        !(measured && MEASUREMENT_UNITS.has(word.toLowerCase())),
    )
    .join(" ");
}

/** Unmarked text on the audited surfaces: interface text, and text excluded as data. */
export type TextReview = {
  untranslated: UntranslatedText[];
  /** Unmarked text accepted by an exclusion, kept as evidence to audit them. */
  excluded: string[];
};

/** Sort one surface's unmarked visible text into untranslated and excluded. */
export function reviewSurface(
  surface: string,
  nodes: readonly VisibleText[],
  exclusions: PreparedExclusions,
): TextReview {
  const review: TextReview = { untranslated: [], excluded: [] };
  for (const node of nodes) {
    const marked = unmarkedText(node.text);
    if (node.enclosed || !LETTER.test(marked)) continue;
    const unmarked = unexcludedText(marked, exclusions);
    if (!unmarked) {
      const text = node.text.trim();
      if (!review.excluded.includes(text)) review.excluded.push(text);
      continue;
    }
    review.untranslated.push({
      surface,
      kind: node.kind,
      text: node.text.trim(),
      unmarked,
      context: node.context,
    });
  }
  return review;
}

/** Add every string leaf of a JSON value, except backend prose, to `into`. */
export function collectDataStrings(
  value: unknown,
  into: Set<string>,
  key?: string,
): void {
  if (typeof value === "string") {
    if (!key || !PROSE_KEYS.has(key)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDataStrings(item, into, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [entryKey, entry] of Object.entries(value))
      collectDataStrings(entry, into, entryKey);
  }
}

/** Format findings as one line each for the failure message. */
export function formatFindings(findings: readonly UntranslatedText[]): string {
  return findings
    .map(
      (finding) =>
        `[${finding.surface}] ${finding.kind} ${JSON.stringify(finding.text)} (unmarked: ${JSON.stringify(finding.unmarked)}) at ${finding.context}`,
    )
    .join("\n");
}

/**
 * Collect visible text nodes and placeholders under `root` in the browser.
 * Text inside form fields, editable regions, `<kbd>`, `aria-hidden` subtrees
 * and avatar initials (derived from names) is skipped. Self-contained:
 * Playwright serializes this function.
 */
function collectInBrowser(
  root: Element,
  markers: { open: string; close: string },
): VisibleText[] {
  const skipped =
    "script, style, noscript, template, textarea, input, select, kbd, title, [aria-hidden='true'], [data-slot='avatar-fallback']";
  const letter = /\p{L}/u;
  const visible = (element: Element) =>
    element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const describe = (element: Element) => {
    const parts: string[] = [];
    for (
      let current: Element | null = element;
      current && current !== document.body && parts.length < 5;
      current = current.parentElement
    ) {
      let part = current.tagName.toLowerCase();
      for (const name of ["role", "data-slot", "data-testid", "aria-label"]) {
        const value = current.getAttribute(name);
        if (value) part += `[${name}=${JSON.stringify(value.slice(0, 40))}]`;
      }
      if (current.id && !/^(radix-|:r|«)/.test(current.id))
        part += `#${current.id}`;
      parts.unshift(part);
    }
    return parts.join(" > ");
  };
  /** Whether `node` lies between an opener and its matching close in a nearby ancestor. */
  const enclosed = (node: Text) => {
    let ancestor = node.parentElement;
    for (let level = 0; ancestor && level < 4; level += 1) {
      let before = "";
      let after = "";
      let seen = false;
      const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (text === node) seen = true;
        else if (seen) after += text.nodeValue ?? "";
        else before += text.nodeValue ?? "";
      }
      let depth = 0;
      for (const character of before) {
        if (character === markers.open) depth += 1;
        else if (character === markers.close) depth = Math.max(0, depth - 1);
      }
      if (depth > 0) {
        let remaining = depth;
        for (const character of after) {
          if (character === markers.open) remaining += 1;
          else if (character === markers.close) {
            remaining -= 1;
            if (remaining < depth) return true;
          }
        }
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  };

  const results: VisibleText[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    const parent = node.parentElement;
    if (!letter.test(text) || !parent) continue;
    if (parent.closest(skipped) || parent.isContentEditable) continue;
    if (!visible(parent)) continue;
    const marked = text.includes(markers.open) || text.includes(markers.close);
    results.push({
      kind: "text",
      text,
      enclosed: !marked && enclosed(node as Text),
      context: describe(parent),
    });
  }
  for (const field of root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >("input[placeholder], textarea[placeholder]")) {
    if (field.closest("[aria-hidden='true']") || !visible(field)) continue;
    if (letter.test(field.placeholder))
      results.push({
        kind: "placeholder",
        text: field.placeholder,
        enclosed: false,
        context: describe(field),
      });
  }
  return results;
}

/**
 * Pseudo-locale audit for one page: opens routes with `?ui-locale=pseudo`,
 * records the data strings the page loads from `/v1`, and collects visible
 * text that has no pseudo marker and is not data.
 *
 * Each `open()` is a full navigation that refetches what the page shows, so a
 * surface is excluded only by the data loaded since then. Library names thus
 * cannot hide a same-named label on another surface.
 */
export class PseudoLocaleAudit {
  private readonly page: Page;
  private readonly evidence: EvidenceAttachment;
  /** Data strings loaded since the last `open()`. */
  private loaded = new Set<string>();
  /** Avatar and animation files the page loaded, read again for their expressions. */
  private readonly gltfUrls = new Set<string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly surfaces: Array<{
    surface: string;
    nodes: VisibleText[];
    loaded: ReadonlySet<string>;
    data: readonly string[];
  }> = [];

  constructor(page: Page, evidence: EvidenceAttachment) {
    this.page = page;
    this.evidence = evidence;
    page.on("response", (response) => this.record(response));
  }

  private record(response: Response): void {
    const url = new URL(response.url());
    const contentType = response.headers()["content-type"] ?? "";
    if (
      url.pathname.startsWith("/v1/") &&
      response.ok() &&
      response.request().method() === "GET" &&
      contentType.includes("model/gltf-binary")
    ) {
      this.gltfUrls.add(response.url());
      return;
    }
    if (
      !url.pathname.startsWith("/v1/") ||
      !response.ok() ||
      !contentType.includes("application/json")
    )
      return;
    const into = this.loaded;
    const pending = response
      .json()
      .then((body: unknown) => collectDataStrings(body, into))
      // A superseded request can lose its body before CDP exposes it; the
      // page then renders the newer response, which is recorded instead.
      .catch(() => undefined);
    this.pending.add(pending);
    void pending.finally(() => this.pending.delete(pending));
  }

  /** Open an application path in the pseudo-locale and confirm it applied. */
  async open(path: string): Promise<void> {
    const url = new URL(path, "http://placeholder");
    url.searchParams.set("ui-locale", "pseudo");
    this.loaded = new Set();
    const response = await this.page.goto(`${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.ok(), `${path} did not load`).toBe(true);
    await this.expectPseudoLocale();
  }

  /** The pseudo-locale exists only in development builds; fail clearly elsewhere. */
  async expectPseudoLocale(): Promise<void> {
    await expect(
      this.page.locator("html"),
      "The pseudo-locale did not apply. It requires a development (Vite) stack.",
    ).toHaveAttribute("lang", PSEUDO_LOCALE);
  }

  /**
   * Collect the visible text of one surface, scoped to `root` (default: the
   * page body), with a screenshot for the owner walkthrough. `data` adds
   * values this surface shows that no `/v1` response carries, such as the
   * build version.
   */
  async check(
    surface: string,
    { root, data = [] }: { root?: Locator; data?: readonly string[] } = {},
  ): Promise<void> {
    await this.expectPseudoLocale();
    const scope = root ?? this.page.locator("body");
    await this.settle(scope);
    const nodes = await scope.evaluate(collectInBrowser, {
      open: PSEUDO_OPEN,
      close: PSEUDO_CLOSE,
    });
    this.surfaces.push({ surface, nodes, loaded: this.loaded, data });
    await this.evidence.attachBuffer(
      `pseudo-locale ${surface}`,
      await this.page.screenshot(),
      "image/png",
    );
  }

  /**
   * Let text that loads after a surface's readiness signal arrive: wait until
   * the text is unchanged across one interval. Live values such as timers never
   * settle, so the wait ends after about four seconds instead of failing.
   */
  private async settle(scope: Locator): Promise<void> {
    let previous: string | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = await scope.innerText();
      if (current === previous) return;
      previous = current;
      await this.page.waitForTimeout(400);
    }
  }

  /**
   * Review every surface checked so far, once the loaded data is recorded.
   * Evidence lists each surface's node count and the text it excluded.
   */
  async review(): Promise<{
    untranslated: UntranslatedText[];
    surfaces: Array<{
      surface: string;
      visibleTextNodes: number;
      excluded: string[];
    }>;
  }> {
    await Promise.allSettled([...this.pending]);
    const identifiers: string[] = [];
    for (const url of this.gltfUrls) {
      // A fresh read: large bodies may no longer be held by the browser.
      const response = await this.page.request.get(url);
      expect(response.ok(), `Could not read ${url} again`).toBe(true);
      identifiers.push(...customExpressionNames(await response.body()));
    }
    const reviews = this.surfaces.map(({ surface, nodes, loaded, data }) =>
      reviewSurface(
        surface,
        nodes,
        prepareExclusions({
          dataStrings: [...loaded, ...data],
          identifiers,
          words: FIXED_WORDS,
        }),
      ),
    );
    return {
      untranslated: reviews.flatMap((review) => review.untranslated),
      surfaces: this.surfaces.map(({ surface, nodes }, index) => ({
        surface,
        visibleTextNodes: nodes.length,
        excluded: reviews[index]?.excluded ?? [],
      })),
    };
  }
}
