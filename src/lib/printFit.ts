import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sizing for the large tab printouts (`.print-receipt--large`): every piece
 * of text grows by the same factor, so the slip keeps the receipt's
 * proportions, and the factor is the largest — up to `MAX_SCALE` — at which
 * every line still fits the tape on one line. Notes are left out; they wrap.
 */

/** Twice the receipt's size, when everything fits. */
export const MAX_SCALE = 2;
/** Never smaller than the receipt itself. */
const MIN_SCALE = 1;
/** The tape's printable width, as set on `.print-receipt` (~80mm). */
export const TAPE_WIDTH = 302;

/** The receipt's own sizes and weights at scale 1, as in PrintableReceipt.css. */
const FONTS = {
  body: { size: 14, weight: 600 },
  brand: { size: 18, weight: 800 },
  small: { size: 13, weight: 600 },
  head: { size: 13.5, weight: 600 },
  total: { size: 17, weight: 800 },
};
/** Gap between a row's label and amount, and before a line's "× 2". */
const ROW_GAP = 12;
const QTY_GAP = 6;

type Font = (typeof FONTS)[keyof typeof FONTS];
/** One line to fit: its pieces of text, the font they're set in, and fixed space between them. */
export type FitLine = { texts: string[]; font: Font; extra: number };

/** The largest scale at which every line fits `width`, given a way to measure text. */
export function fitScale(lines: FitLine[], measure: (text: string, font: Font) => number, width = TAPE_WIDTH): number {
  let widest = 0;
  for (const line of lines) {
    const w = line.texts.reduce((sum, t) => sum + measure(t, line.font), 0) + line.extra;
    widest = Math.max(widest, w);
  }
  if (widest === 0) return MAX_SCALE;
  // Gaps don't scale, but text does — a slightly low factor is the safe side.
  const scale = Math.floor((width / widest) * 20) / 20;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** The lines on a rendered slip, read from its markup. */
function linesOf(slip: HTMLElement): FitLine[] {
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const lines: FitLine[] = [];
  for (const el of slip.querySelectorAll('.print-receipt__brand')) {
    lines.push({ texts: [text(el)], font: FONTS.brand, extra: 0 });
  }
  for (const el of slip.querySelectorAll('.print-receipt__station, .print-receipt__foot')) {
    lines.push({ texts: [text(el)], font: FONTS.small, extra: 0 });
  }
  for (const el of slip.querySelectorAll('.print-receipt__head > div:not(.print-receipt__brand)')) {
    lines.push({ texts: [text(el)], font: FONTS.head, extra: 0 });
  }
  for (const row of slip.querySelectorAll('.print-receipt__row')) {
    const parts = [...row.children].map(text).filter(Boolean);
    lines.push({
      texts: parts,
      font: row.classList.contains('print-receipt__total') ? FONTS.total : FONTS.body,
      extra: ROW_GAP * Math.max(0, parts.length - 1) + (row.querySelector('.print-receipt__qty') ? QTY_GAP : 0),
    });
  }
  return lines;
}

let canvas: HTMLCanvasElement | null = null;

function measureText(text: string, font: Font): number {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return text.length * font.size * 0.6;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'Arial, sans-serif';
  ctx.font = `${font.weight} ${font.size}px ${family}`;
  return ctx.measureText(text).width;
}

/**
 * Sets `--print-scale` on the slip after every render, so it's right by the
 * time anything prints. Off (`enabled` false) leaves the slip alone.
 */
export function usePrintFit(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const slip = ref.current;
    if (!slip || !enabled) return;
    slip.style.setProperty('--print-scale', String(scaleFor(slip)));
  });
}

/** The scale a rendered slip prints at. */
export function scaleFor(slip: HTMLElement): number {
  return fitScale(linesOf(slip), measureText);
}
