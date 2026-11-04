import type { UiLocale } from "@animama/runtime-contracts/locale";

import { cn } from "@/lib/utils";

/*
 * Round flag icons for the language picker, drawn inline so they look the
 * same everywhere (Windows does not draw flag emoji). Each UI Locale shows
 * the flag of the country it is most associated with; simplified for icon
 * size.
 */

const STAR =
  "M0,-1 L0.2245,-0.309 L0.9511,-0.309 L0.3633,0.118 L0.5878,0.809 L0,0.382 L-0.5878,0.809 L-0.3633,0.118 L-0.9511,-0.309 L-0.2245,-0.309 Z";

function UnitedStates() {
  return (
    <>
      <rect width="24" height="24" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((stripe) => (
        <rect
          key={stripe}
          y={(stripe * 24) / 13}
          width="24"
          height={24 / 13}
          fill="#b22234"
        />
      ))}
      <rect width="11" height={(7 * 24) / 13} fill="#3c3b6e" />
      {[
        [2.2, 2.2],
        [5.5, 2.2],
        [8.8, 2.2],
        [3.8, 4.6],
        [7.2, 4.6],
        [2.2, 7],
        [5.5, 7],
        [8.8, 7],
        [3.8, 9.4],
        [7.2, 9.4],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="0.75" fill="#fff" />
      ))}
    </>
  );
}

function Japan() {
  return (
    <>
      <rect width="24" height="24" fill="#fff" />
      <circle cx="12" cy="12" r="5.4" fill="#bc002d" />
    </>
  );
}

function Korea() {
  const bars = (x: number, y: number, angle: number) => (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} fill="#000">
      <rect x="-2.4" y="-1.5" width="4.8" height="0.75" />
      <rect x="-2.4" y="-0.375" width="4.8" height="0.75" />
      <rect x="-2.4" y="0.75" width="4.8" height="0.75" />
    </g>
  );
  return (
    <>
      <rect width="24" height="24" fill="#fff" />
      <g transform="translate(12 12) rotate(33.7)">
        <path d="M-4.6,0 A4.6,4.6 0 0 1 4.6,0 Z" fill="#cd2e3a" />
        <path d="M-4.6,0 A4.6,4.6 0 0 0 4.6,0 Z" fill="#0047a0" />
        <circle cx="-2.3" cy="0" r="2.3" fill="#cd2e3a" />
        <circle cx="2.3" cy="0" r="2.3" fill="#0047a0" />
      </g>
      {bars(5, 6.4, -56.3)}
      {bars(19, 17.6, -56.3)}
      {bars(19, 6.4, 56.3)}
      {bars(5, 17.6, 56.3)}
    </>
  );
}

function China() {
  return (
    <>
      <rect width="24" height="24" fill="#de2910" />
      <path d={STAR} transform="translate(7.5 8) scale(3.2)" fill="#ffde00" />
      {[
        [12.5, 3.8],
        [14.6, 6.2],
        [14.6, 9.4],
        [12.5, 11.8],
      ].map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={STAR}
          transform={`translate(${x} ${y}) scale(1.05)`}
          fill="#ffde00"
        />
      ))}
    </>
  );
}

function Taiwan() {
  return (
    <>
      <rect width="24" height="24" fill="#fe0000" />
      <rect width="13" height="12.5" fill="#000095" />
      <circle cx="6.5" cy="6.25" r="3.4" fill="#fff" />
      <circle cx="6.5" cy="6.25" r="2.1" fill="#000095" />
      <circle cx="6.5" cy="6.25" r="1.75" fill="#fff" />
    </>
  );
}

const FLAGS: Record<UiLocale, () => React.JSX.Element> = {
  en: UnitedStates,
  ja: Japan,
  ko: Korea,
  "zh-Hans": China,
  "zh-Hant": Taiwan,
};

/**
 * A UI Locale's flag as a small round icon. Its ring is a class
 * (`rounded-full` and a shadow) rather than an inline style, which the
 * site's CSP refuses in the header prerendered for Animama Cloud's pages.
 */
export function LocaleFlag({
  locale,
  className,
}: {
  locale: UiLocale;
  className?: string;
}) {
  const Flag = FLAGS[locale];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(
        "rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.08)]",
        className,
      )}
    >
      <clipPath id={`flag-${locale}`}>
        <circle cx="12" cy="12" r="12" />
      </clipPath>
      <g clipPath={`url(#flag-${locale})`}>
        <Flag />
      </g>
    </svg>
  );
}
