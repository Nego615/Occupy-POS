import { describe, expect, it } from 'vitest';
import { fitScale, MAX_SCALE, type FitLine } from './printFit';

// Every character 10px wide at 14px, scaling with the font size.
const measure = (text: string, font: { size: number }) => text.length * 10 * (font.size / 14);
const body = { size: 14, weight: 600 };
const line = (...texts: string[]): FitLine => ({ texts, font: body, extra: 0 });

describe('sizing a tab to the tape', () => {
  it('prints at twice the size when every line fits', () => {
    expect(fitScale([line('Coke × 3', 'TSh 4,500')], measure, 400)).toBe(MAX_SCALE);
  });

  it('shrinks everything by the same factor to fit the longest line', () => {
    // 31 characters is 310px at scale 1; 465px of tape fits it at 1.5.
    expect(fitScale([line('Kilimanjaro Lager × 3', 'TSh 15,000'), line('Tax')], measure, 465)).toBe(1.5);
  });

  it('rounds down, and never goes below the receipt’s own size', () => {
    expect(fitScale([line('x'.repeat(27))], measure, 400)).toBe(1.45);
    expect(fitScale([line('x'.repeat(80))], measure, 300)).toBe(1);
  });
});
