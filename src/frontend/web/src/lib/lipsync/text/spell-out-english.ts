/**
 * Spells out English numbers, symbols and common abbreviations as words, the
 * way a voice should read them: "$5.99" becomes "five dollars ninety-nine
 * cents" and "10/13/2026" becomes "October thirteenth, twenty twenty-six".
 *
 * Pocket TTS speaks the result, and lip-sync plans English from it, so the
 * mouth expects the syllables the voice says. Each change is reported as a
 * segment with its source range, so provider timing for the original text can
 * still be matched to the spoken words. Emoji and symbols with no spoken form
 * are dropped.
 */

export type SpelledSegment = {
  /** Range in the source text. */
  start: number;
  end: number;
  /** The words spoken for that range; unchanged text is copied as it is. */
  text: string;
  spelled: boolean;
};

// prettier-ignore
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
// prettier-ignore
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [
  [1e12, "trillion"],
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
] as const;
// prettier-ignore
const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
];
const ORDINAL_WORDS: Record<string, string> = {
  one: "first",
  two: "second",
  three: "third",
  five: "fifth",
  eight: "eighth",
  nine: "ninth",
  twelve: "twelfth",
};

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const ones = n % 10;
  const tens = TENS[Math.floor(n / 10)]!;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return belowHundred(rest);
  const head = `${ONES[hundreds]} hundred`;
  return rest ? `${head} ${belowHundred(rest)}` : head;
}

/** A whole number in words, for example 1250 as "one thousand two hundred fifty". */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value < 0) return `minus ${numberToWords(-value)}`;
  // Beyond trillions, read digit by digit rather than name a scale.
  if (value >= 1e15) return digitsToWords(String(Math.floor(value)));
  let n = Math.floor(value);
  if (n === 0) return "zero";
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${belowThousand(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** An ordinal in words, for example 22 as "twenty-second". */
export function ordinalToWords(value: number): string {
  const words = numberToWords(value);
  const match = /([a-z]+)$/.exec(words)!;
  const last = match[1]!;
  let ordinal: string;
  if (ORDINAL_WORDS[last]) ordinal = ORDINAL_WORDS[last];
  else if (last.endsWith("y")) ordinal = `${last.slice(0, -1)}ieth`;
  else ordinal = `${last}th`;
  return words.slice(0, match.index) + ordinal;
}

/** A year read the usual way: 1999 as "nineteen ninety-nine", 2005 as "two thousand five". */
export function yearToWords(year: number): string {
  if (year >= 2000 && year < 2010) return numberToWords(year);
  const high = Math.floor(year / 100);
  const low = year % 100;
  if (low === 0) return `${belowHundred(high)} hundred`;
  const tail = low < 10 ? `oh ${ONES[low]}` : belowHundred(low);
  return `${belowHundred(high)} ${tail}`;
}

/** Each digit on its own, for phone numbers and codes. */
function digitsToWords(digits: string): string {
  return [...digits].map((d) => ONES[Number(d)]).join(" ");
}

const parseAmount = (text: string) => Number(text.replace(/,/g, ""));

/**
 * An amount such as "1,250" or "2.5"; digits after a point, and numbers longer
 * than fifteen digits, are read one by one.
 */
function amountToWords(amount: string): string {
  const [whole, fraction] = amount.split(".");
  const digits = whole!.replace(/,/g, "");
  const words =
    digits.length > 15 ? digitsToWords(digits) : numberToWords(Number(digits));
  return fraction ? `${words} point ${digitsToWords(fraction)}` : words;
}

/** "nineteen ninety" as "nineteen nineties", "two thousand" as "two thousands". */
function pluralWords(words: string): string {
  return words.endsWith("y") ? `${words.slice(0, -1)}ies` : `${words}s`;
}

const CURRENCIES: Record<
  string,
  { one: string; many: string; cent?: [string, string] }
> = {
  $: { one: "dollar", many: "dollars", cent: ["cent", "cents"] },
  "€": { one: "euro", many: "euros", cent: ["cent", "cents"] },
  "£": { one: "pound", many: "pounds", cent: ["penny", "pence"] },
  "¥": { one: "yen", many: "yen" },
};

const MAGNITUDES: Record<string, string> = {
  k: "thousand",
  K: "thousand",
  m: "million",
  M: "million",
  b: "billion",
  B: "billion",
  bn: "billion",
};

function currencyToWords(
  symbol: string,
  amount: string,
  magnitude: string | undefined,
): string {
  const currency = CURRENCIES[symbol]!;
  if (magnitude) {
    const scale = MAGNITUDES[magnitude] ?? magnitude.toLowerCase();
    return `${amountToWords(amount)} ${scale} ${currency.many}`;
  }
  const [whole, fraction] = amount.split(".");
  const units = parseAmount(whole!);
  const cents = fraction ? Number(fraction.padEnd(2, "0").slice(0, 2)) : 0;
  const parts: string[] = [];
  if (units || !cents) {
    parts.push(
      `${numberToWords(units)} ${units === 1 ? currency.one : currency.many}`,
    );
  }
  if (cents) {
    const cent = currency.cent;
    parts.push(
      cent
        ? `${numberToWords(cents)} ${cents === 1 ? cent[0] : cent[1]}`
        : numberToWords(cents),
    );
  }
  return parts.join(" ");
}

const UNITS: Record<string, [string, string]> = {
  m: ["meter", "meters"],
  kg: ["kilogram", "kilograms"],
  g: ["gram", "grams"],
  km: ["kilometer", "kilometers"],
  cm: ["centimeter", "centimeters"],
  mm: ["millimeter", "millimeters"],
  mi: ["mile", "miles"],
  mph: ["mile per hour", "miles per hour"],
  kph: ["kilometer per hour", "kilometers per hour"],
  "km/h": ["kilometer per hour", "kilometers per hour"],
  lb: ["pound", "pounds"],
  lbs: ["pound", "pounds"],
  oz: ["ounce", "ounces"],
  ml: ["milliliter", "milliliters"],
  min: ["minute", "minutes"],
  mins: ["minute", "minutes"],
  hr: ["hour", "hours"],
  hrs: ["hour", "hours"],
  sec: ["second", "seconds"],
  KB: ["kilobyte", "kilobytes"],
  MB: ["megabyte", "megabytes"],
  GB: ["gigabyte", "gigabytes"],
  TB: ["terabyte", "terabytes"],
};

/** Magnitudes after a plain number: "3k", "2.5M". A lone "m" is meters there. */
const NUMBER_MAGNITUDES: Record<string, string> = {
  k: "thousand",
  K: "thousand",
  M: "million",
  B: "billion",
  bn: "billion",
};

/** Slash pairs with a fixed reading. */
const SLASH_PHRASES: Record<string, string> = {
  "1/2": "one half",
  "1/3": "one third",
  "2/3": "two thirds",
  "1/4": "one quarter",
  "3/4": "three quarters",
  "24/7": "twenty-four seven",
  "50/50": "fifty-fifty",
};

/** "8/10" reads as a score when its second number is a usual scale. */
const SCORE_SCALES = new Set([5, 10, 100]);

/** Fractions read as fractions rather than dates: "5/8" is five eighths. */
const FRACTION_NAMES: Record<number, [string, string]> = {
  2: ["half", "halves"],
  3: ["third", "thirds"],
  4: ["quarter", "quarters"],
  8: ["eighth", "eighths"],
  16: ["sixteenth", "sixteenths"],
};

function timeToWords(
  hour: string,
  minute: string,
  meridiem: string | undefined,
): string {
  const m = Number(minute);
  let words = numberToWords(Number(hour));
  if (m === 0) words += meridiem ? "" : " o'clock";
  else if (m < 10) words += ` oh ${ONES[m]}`;
  else words += ` ${belowHundred(m)}`;
  if (meridiem) {
    // "pm" and "p.m." read as the letters P M.
    words += ` ${meridiem.replace(/\./g, "").toUpperCase().split("").join(" ")}`;
  }
  return words;
}

function dateToWords(
  first: number,
  second: number,
  year: string | undefined,
): string | null {
  // Month first, unless the first number cannot be a month.
  const [month, day] = first > 12 ? [second, first] : [first, second];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${MONTHS[month - 1]} ${ordinalToWords(day)}`;
  if (!year) return date;
  return `${date}, ${yearToWords(Number(year.length === 2 ? `20${year}` : year))}`;
}

type Spell = (match: RegExpExecArray, source: string) => string | null;

/**
 * Keep a sentence's full stop that an abbreviation's period stood for, as in
 * "and so on, etc. Then": the match ends in "." before a new sentence.
 */
function keepStop(spell: Spell): Spell {
  return (match, source) => {
    const words = spell(match, source);
    return words === null ? null : `${words}${stopAfter(match, source)}`;
  };
}

/** "." when the match's final period also ends its sentence. */
function stopAfter(match: RegExpExecArray, source: string): string {
  if (!match[0].endsWith(".")) return "";
  const rest = source.slice(match.index + match[0].length);
  return /^(\s+[A-Z]|\s*$)/.test(rest) ? "." : "";
}

const ABBREVIATIONS: Array<[RegExp, Spell]> = [
  [/\bDr\./y, () => "Doctor"],
  [/\bMr\./y, () => "Mister"],
  [/\bMrs\./y, () => "Missus"],
  [/\bMs\./y, () => "Miz"],
  [/\bJr\./y, () => "Junior"],
  [/\bSr\./y, () => "Senior"],
  [/\bvs\./y, () => "versus"],
  [/\betc\./y, keepStop(() => "et cetera")],
  [/\be\.g\./y, () => "for example"],
  [/\bi\.e\./y, () => "that is"],
  [/\bapprox\./y, () => "approximately"],
  [/\bNo\.(?=\s*\d)/y, () => "number"],
  // "St." is Street after a name ("Baker St.") and Saint before one ("St. Louis").
  [
    /\bSt\./y,
    (match, source) => {
      // A capitalised word before "St." is a street's name unless it starts
      // the sentence ("Happy St. Patrick's Day").
      const before = source.slice(0, match.index);
      const afterName =
        /[A-Z][\p{L}'’]*\s+$/u.test(before) &&
        !/(^|[.!?]\s+)[A-Z][\p{L}'’]*\s+$/u.test(before);
      const beforeName = /^\s+[A-Z]/.test(
        source.slice(match.index + match[0].length),
      );
      return beforeName && !afterName
        ? "Saint"
        : `Street${stopAfter(match, source)}`;
    },
  ],
];

const MERIDIEM = String.raw`\s*([ap]\.?m\.?)(?![a-z])`;
const NUMBER = String.raw`\d+(?:\.\d+)?`;
/** A number with optional thousands separators and decimals: 10,000 or 15.5. */
const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/** Words that make "30s" a duration wherever they stand beside it. */
const SECONDS_BEFORE = /\b(rest|wait|hold|within|takes|took|lasts)\s+$/i;
const SECONDS_AFTER = /^\s+(between|rest|left|each|later|remaining|per)\b/i;
/** "on" and "off" make a duration only at the end of a phrase: "20s on, 10s off". */
const SECONDS_ON_OFF = /^\s+(on|off)\s*([^\w\s]|$)/i;
/**
 * Words that introduce a decade as often as a duration ("for 90s anime", "for
 * 30s."): a duration only when the phrase ends after the number or a duration
 * word follows it.
 */
const SECONDS_MAYBE_BEFORE = /\b(for|in|every|after|another)\s+$/i;
/**
 * The end of a phrase: the end of the text or punctuation, but not a hyphen,
 * dash or slash that joins a word ("90s-era", "80s/90s").
 */
const PHRASE_END = /^\s*(?:$|(?![-–/][\p{L}\p{N}])[^\p{L}\p{N}\s'_])/u;

/** Whether "<number>s" between `before` and `after` reads as seconds. */
function secondsCue(before: string, after: string): boolean {
  const cuedAfter = SECONDS_AFTER.test(after) || SECONDS_ON_OFF.test(after);
  if (SECONDS_BEFORE.test(before) || cuedAfter) return true;
  return SECONDS_MAYBE_BEFORE.test(before) && PHRASE_END.test(after);
}

/** Rules for text starting at a digit or symbol, in priority order; the first that reads its match wins. */
const RULES: Array<[RegExp, Spell]> = [
  // ISO dates: 2026-10-13.
  [
    /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/y,
    (m) => dateToWords(Number(m[2]), Number(m[3]), m[1]),
  ],
  // Phone numbers, digit by digit: (555) 012-3456, 555-012-3456, and 555-0123
  // after "call", "number" and the like. Otherwise 500-1000 is a range.
  [
    /(?<![\d.,])(\(\d{3}\)\s?|\d{3}[-.\s])?\d{3}-\d{4}(?![\d-])/y,
    (m, source) => {
      const cued =
        /\b(call|phone|number|dial|text|tel|reach)\b[^.!?]{0,20}$/i.test(
          source.slice(Math.max(0, m.index - 40), m.index),
        );
      // A written range never has a four-digit part starting with 0 (555-0123).
      const bareLooksLikePhone =
        /^\d{3}-0/.test(m[0]) || m[0].startsWith("555");
      if (!m[1] && !cued && !bareLooksLikePhone) return null;
      return m[0]
        .split(/[^\d]+/)
        .filter(Boolean)
        .map(digitsToWords)
        .join(", ");
    },
  ],
  // Currency ranges: $5-10 and $500–1,000 name the currency once; $5.99-$9.99
  // reads each price in full.
  [
    new RegExp(
      String.raw`([$€£¥])(${AMOUNT})\s?[-–]\s?[$€£¥]?(${AMOUNT})(?:(bn|[kKmMbB])|\s(thousand|million|billion|trillion))?(?![\d.,]*\d)(?![A-Za-z])`,
      "y",
    ),
    (m) => {
      const symbol = m[1]!;
      // "$1-2 million" and "$5-$10k" share one magnitude.
      const magnitude = m[4] ?? m[5];
      if (magnitude) {
        const scale = MAGNITUDES[magnitude] ?? magnitude.toLowerCase();
        return `${amountToWords(m[2]!)} to ${amountToWords(m[3]!)} ${scale} ${CURRENCIES[symbol]!.many}`;
      }
      if (m[2]!.includes(".") || m[3]!.includes(".")) {
        return `${currencyToWords(symbol, m[2]!, undefined)} to ${currencyToWords(symbol, m[3]!, undefined)}`;
      }
      return `${amountToWords(m[2]!)} to ${amountToWords(m[3]!)} ${CURRENCIES[symbol]!.many}`;
    },
  ],
  // Currency, with an optional magnitude: $5.99, €4, $3k, £2.5M, $5 million.
  [
    /([$€£¥])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(bn|[kKmMbB])|\s(thousand|million|billion|trillion))?(?![\d,]*\d)(?![A-Za-z])/y,
    (m) => currencyToWords(m[1]!, `${m[2]}${m[3] ?? ""}`, m[4] ?? m[5]),
  ],
  // Numeric dates, scores and fractions: 10/13/2026, 13/10/26, 8/10, 4.5/5, 5/8.
  [
    /(?<![\d/.])(\d{1,3}(?:\.\d+)?)\/(\d{1,3})(?:\/(\d{4}|\d{2}))?(?![\d/])/y,
    (m, source) => {
      const [first, second] = [Number(m[1]), Number(m[2])];
      const pair = `${m[1]}/${m[2]}`;
      if (!m[3] && SLASH_PHRASES[pair]) return SLASH_PHRASES[pair];
      if (!m[3] && SCORE_SCALES.has(second)) {
        return `${amountToWords(m[1]!)} out of ${numberToWords(second)}`;
      }
      const fraction = FRACTION_NAMES[second];
      // "On 3/16" or "due 5/8" is a date.
      const dateCue =
        /\b(on|by|due|until|till|from|since|before|after)\s+$/i.test(
          source.slice(Math.max(0, m.index - 10), m.index),
        );
      if (
        !m[3] &&
        !dateCue &&
        fraction &&
        first < second &&
        Number.isInteger(first)
      ) {
        return `${numberToWords(first)} ${first === 1 ? fraction[0] : fraction[1]}`;
      }
      return Number.isInteger(first) ? dateToWords(first, second, m[3]) : null;
    },
  ],
  // Times: 3:30, 3:30 pm, 12:05 a.m.
  [
    new RegExp(
      String.raw`(?<!\d)(\d{1,2}):(\d{2})(?:${MERIDIEM})?(?!\d)`,
      "iy",
    ),
    keepStop((m) =>
      Number(m[1]) > 24 || Number(m[2]) > 59
        ? null
        : timeToWords(m[1]!, m[2]!, m[3]),
    ),
  ],
  // Ratios: 16:9, 3:2.
  [
    /(?<![\d:])(\d+):(\d+)(?![\d:])/y,
    (m) => `${numberToWords(Number(m[1]))} to ${numberToWords(Number(m[2]))}`,
  ],
  // Hours with am or pm: 3pm, 11 a.m.
  [
    new RegExp(String.raw`(?<![\d:])(\d{1,2})${MERIDIEM}`, "iy"),
    keepStop((m) =>
      Number(m[1]) > 12 ? null : timeToWords(m[1]!, "00", m[2]),
    ),
  ],
  // Ordinals: 1st, 22nd, 103rd.
  [/(?<![\d.])(\d+)(st|nd|rd|th)\b/iy, (m) => ordinalToWords(Number(m[1]))],
  // Ranges: 5-10, 5%-10%, 5-10%, 3-4 pm, 1999-2005. "5 - 3 = 2" is a subtraction.
  [
    new RegExp(
      String.raw`(?<![\d.,-])(${AMOUNT})(?![\d,.]\d)(%)?\s?[-–]\s?(${AMOUNT})(?![\d,.]\d|\d)(%)?(?:${MERIDIEM})?`,
      "iy",
    ),
    (m, source) => {
      const rest = source.slice(m.index + m[0].length);
      if (/^\s*=/.test(rest))
        return `${amountToWords(m[1]!)} minus ${amountToWords(m[3]!)}`;
      const years = [m[1]!, m[3]!].every((n) => /^(19|20)\d\d$/.test(n));
      const read = (n: string) =>
        years ? yearToWords(Number(n)) : amountToWords(n);
      let words = `${read(m[1]!)} to ${read(m[3]!)}`;
      if (m[2] || m[4]) words += " percent";
      if (m[5])
        words += ` ${m[5].replace(/\./g, "").toUpperCase().split("").join(" ")}`;
      return words;
    },
  ],
  // Temperatures and angles: 72°F, -4°C, 90°.
  [
    new RegExp(String.raw`([-−])?(${NUMBER})\s?°\s?([FC])?(?![A-Za-z])`, "y"),
    (m) => {
      const scale =
        m[3] === "F" ? " Fahrenheit" : m[3] === "C" ? " Celsius" : "";
      return `${m[1] ? "minus " : ""}${amountToWords(m[2]!)} degrees${scale}`;
    },
  ],
  // Percentages: 75%, -2.5%.
  [
    new RegExp(String.raw`([-−])?(${NUMBER})\s?%`, "y"),
    (m) => `${m[1] ? "minus " : ""}${amountToWords(m[2]!)} percent`,
  ],
  // Versions and dotted numbers: 2.5.1.
  [
    /(?<![\d.])\d+(?:\.\d+){2,}(?!\.?\d)/y,
    (m) =>
      m[0]
        .split(".")
        .map((part) => numberToWords(Number(part)))
        .join(" point "),
  ],
  // Numbers with a unit or magnitude: 3kg, 5 km, 10mph, 3k, 2.5M.
  [
    new RegExp(
      String.raw`(${NUMBER})\s?(km\/h|[A-Za-z]{1,4})(?![A-Za-z\d])`,
      "y",
    ),
    (m) => {
      const amount = m[1]!;
      const unit = UNITS[m[2]!];
      if (unit)
        return `${amountToWords(amount)} ${amount === "1" ? unit[0] : unit[1]}`;
      const magnitude = NUMBER_MAGNITUDES[m[2]!];
      return magnitude ? `${amountToWords(amount)} ${magnitude}` : null;
    },
  ],
  // Negative numbers: -4, −4.
  [
    new RegExp(String.raw`(?<![\w.])[-−](${NUMBER})(?!\.?\d)`, "y"),
    (m) => `minus ${amountToWords(m[1]!)}`,
  ],
  // Decimals: 2.5, 0.75, and .5 after a space.
  [/(?<![\d.])\d+\.\d+(?!\.?\d)/y, (m) => amountToWords(m[0])],
  [/(?<![\w.])\.(\d+)(?![\d.])/y, (m) => `point ${digitsToWords(m[1]!)}`],
  // Decades: 1990s, '90s.
  [
    /(?<![\d'])(1[1-9]|20)(\d)0s\b/y,
    (m) => pluralWords(yearToWords(Number(`${m[1]}${m[2]}0`))),
  ],
  // "80s" is a decade ("80s music", "in your 30s") and "45s" is left as written,
  // unless a duration word sits beside it: "rest 60s", "wait 10s", "20s left".
  [
    /(?<!\d)'?(\d{1,3})s\b/y,
    (m, source) => {
      const value = Number(m[1]);
      const decade = /^[2-9]0$/.test(m[1]!);
      const after = source.slice(m.index + m[0].length);
      const seconds =
        !m[0].startsWith("'") && secondsCue(source.slice(0, m.index), after);
      if (seconds)
        return `${numberToWords(value)} ${value === 1 ? "second" : "seconds"}`;
      return decade ? pluralWords(TENS[value / 10]!) : null;
    },
  ],
  // Years: 1900 to 2099 standing alone, or an older year after "in", "since"
  // and the like. "1250 yen" stays a number.
  [
    /(?<![\d.,$€£¥])(1[1-9]\d\d|20\d\d)(?![\d%]|[.,]\d)/y,
    (m, source) => {
      const year = Number(m[1]);
      const before = source.slice(Math.max(0, m.index - 12), m.index);
      const cued = /\b(in|since|from|until|by|of|year|circa)\s+$/i.test(before);
      return year >= 1900 || cued ? yearToWords(year) : null;
    },
  ],
  // Whole numbers: 3, 1,250, 1250.
  [/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(?!\d)/y, (m) => amountToWords(m[1]!)],
  // Number signs and hashtags: #4, #love.
  [/#\s?(\d+)/y, (m) => `number ${numberToWords(Number(m[1]))}`],
  [/#(?=[A-Za-z])/y, () => "hashtag"],
  [/&/y, () => "and"],
  [/@/y, () => "at"],
  [/\+/y, () => "plus"],
  [/=/y, () => "equals"],
  // "×" or "*" between numbers, and "~" before one.
  [/(?<=\d\s?)[×*](?=\s?\d)/y, () => "times"],
  [/~(?=\s?\d)/y, () => "about"],
];

/** Characters a rule may start at. */
const RULE_START = /[\d$€£¥#&@+=~×*\-−(.']/;

/** Symbols dropped when no rule reads them in context, rather than read oddly. */
const DROPPED_SYMBOLS = new Set([
  "&",
  "@",
  "+",
  "=",
  "#",
  "%",
  "°",
  "~",
  "×",
  "*",
]);

/** Emoji and pictographs, with their joiners, modifiers and variation selectors. */
const EMOJI =
  /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\u{FE0F}|\u{200D}|\u{20E3}|\p{Extended_Pictographic}|\p{Emoji_Modifier})*/uy;

/** Run `patterns` at `index`; the first that reads its match wins. */
function readAt(
  patterns: Array<[RegExp, Spell]>,
  text: string,
  index: number,
): { length: number; words: string } | null {
  for (const [pattern, spell] of patterns) {
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) continue;
    const words = spell(match, text);
    if (words !== null) return { length: match[0].length, words };
  }
  return null;
}

/**
 * The text as segments: unchanged runs copied as they are, and spelled-out
 * numbers, symbols and abbreviations with their source ranges. Dropped emoji
 * and symbols are segments with empty text.
 */
export function spellOutEnglishSegments(text: string): SpelledSegment[] {
  const segments: SpelledSegment[] = [];
  let plainStart = 0;
  const replace = (start: number, end: number, words: string) => {
    if (start > plainStart) {
      segments.push({
        start: plainStart,
        end: start,
        text: text.slice(plainStart, start),
        spelled: false,
      });
    }
    // Keep spelled words apart from the letters and digits around them.
    const isWordChar = (c: string | undefined) =>
      c !== undefined && /[\p{L}\p{N}]/u.test(c);
    const previous = segments[segments.length - 1];
    const afterSpelled =
      previous?.spelled &&
      previous.end === start &&
      /[\p{L}\p{N}.]$/u.test(previous.text);
    const before =
      words && (isWordChar(text[start - 1]) || afterSpelled) ? " " : "";
    const after = words && isWordChar(text[end]) ? " " : "";
    segments.push({
      start,
      end,
      text: `${before}${words}${after}`,
      spelled: true,
    });
    plainStart = end;
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i]!;
    const read = /[A-Za-z]/.test(char)
      ? readAt(ABBREVIATIONS, text, i)
      : RULE_START.test(char)
        ? readAt(RULES, text, i)
        : null;
    if (read) {
      replace(i, i + read.length, read.words);
      i += read.length;
      continue;
    }
    EMOJI.lastIndex = i;
    const emoji = EMOJI.exec(text);
    if (emoji) {
      replace(i, i + emoji[0].length, "");
      i += emoji[0].length;
      continue;
    }
    if (DROPPED_SYMBOLS.has(char)) {
      replace(i, i + 1, "");
      i += 1;
      continue;
    }
    // Advance by whole code points so surrogate pairs stay intact.
    i += char.codePointAt(0)! > 0xffff ? 2 : 1;
  }
  if (text.length > plainStart) {
    segments.push({
      start: plainStart,
      end: text.length,
      text: text.slice(plainStart),
      spelled: false,
    });
  }
  return segments;
}

/** English text with numbers, symbols and abbreviations spelled out, and emoji dropped. */
export function spellOutEnglish(text: string): string {
  return spellOutEnglishSegments(text)
    .map((segment) => segment.text)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .trim();
}
