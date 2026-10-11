/**
 * A shop's brand colors. Settings hold them as "#1d5fa8" hex, or null for the
 * stock ink; this turns them into the --brand / --accent tokens on :root.
 */

export const BRAND_PRESETS: { name: string; hex: string }[] = [
  { name: 'Navy', hex: '#1f3a8a' },
  { name: 'Ocean', hex: '#1d5fa8' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Forest', hex: '#2f5d3a' },
  { name: 'Espresso', hex: '#5b3a29' },
  { name: 'Burgundy', hex: '#7f1d3a' },
  { name: 'Amber', hex: '#b45309' },
  { name: 'Slate', hex: '#475569' },
];

const INK = '#121212';
const PAPER = '#ffffff';

/** "#1D5FA8", "1d5fa8", or "#abc" → "#1d5fa8"; anything else → null. */
export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  if (/^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join('')}`;
  return null;
}

/** WCAG relative luminance of a "#rrggbb" color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or ink — whichever reads better on `hex`. */
export function textOn(hex: string): string {
  return contrast(hex, PAPER) >= contrast(hex, INK) ? PAPER : INK;
}

/**
 * Under 3:1 against the white page (WCAG's floor for controls and chart
 * marks), a button or bar in this color is hard to make out.
 */
export function tooLight(hex: string): boolean {
  return contrast(hex, PAPER) < 3;
}

/** The token values for a brand and accent; null leaves a token at its stock value. */
export function brandTokens(
  brand: string | null | undefined,
  accent: string | null | undefined,
): Record<string, string | null> {
  const on = brand ? textOn(brand) : null;
  return {
    '--brand': brand ?? null,
    '--on-brand': on,
    '--on-brand-soft': on && (on === PAPER ? 'rgba(255, 255, 255, 0.72)' : 'rgba(18, 18, 18, 0.64)'),
    '--accent': accent ?? null,
  };
}

/** Sets (or clears) the brand tokens on the page, so every screen picks them up. */
export function applyBrand(
  brand: string | null | undefined,
  accent: string | null | undefined,
  root: HTMLElement = document.documentElement,
): void {
  for (const [name, value] of Object.entries(brandTokens(brand, accent))) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}
