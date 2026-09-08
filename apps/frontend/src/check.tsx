import { h } from '@wuzzy/static-site';

/**
 * The affirmative mark, drawn rather than typed.
 *
 * Berkeley Mono has no check-mark glyph. Neither U+2713, U+2714 nor U+2611 is
 * in any of its four faces, so a typed tick falls out of the font stack and is
 * drawn by whatever the visitor happens to have: SFMono on a Mac, Consolas on
 * Windows, Adwaita Mono on this machine. Three visitors, three different marks
 * at three different weights, each sitting mid-line beside Berkeley Mono.
 *
 * Drawing it removes the guess. Four things here are load-bearing, and each is
 * a real cross-browser failure rather than belt-and-braces:
 *
 *  - The wrapper is `inline-flex`, because our own Tailwind preflight sets
 *    `svg { display: block }`. A bare inline SVG would break onto its own line.
 *  - `viewBox` AND numeric `width`/`height`: an SVG with neither renders at the
 *    CSS default 300x150, so if the stylesheet ever fails to load the mark is
 *    a floor of 12px rather than an enormous one.
 *  - Sizing in CSS (`size-[1em]`) on top of those attributes, because Safari
 *    has never sized inline SVG reliably from attributes alone. `1em` also ties
 *    the mark to the line's own font-size, so it tracks the 11px receipt type.
 *  - `focusable="false"`, because legacy Edge and IE put SVG in the tab order.
 *
 * `currentColor` inherits the accent green from the wrapper, so the mark has no
 * colour of its own to keep in sync with the palette.
 */
export const Check = ({ label }: { label: string }) => (
  <span class="text-accent inline-flex items-center gap-1 font-medium">
    {label}
    <svg
      class="size-[1em] shrink-0"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 6.4 4.9 8.9 9.5 3.1" />
    </svg>
  </span>
);
