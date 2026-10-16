import { describe, expect, it } from 'vitest';
import { averagedCost } from './inventory';

describe('stock received by hand', () => {
  it('averages the cost across what was on the shelf and what came in', () => {
    // 10 on hand at 1,000, 10 more at 1,500 → 1,250 each.
    expect(averagedCost({ stock: 10, cost: 1_000 }, 10, 1_500)).toBe(1_250);
  });

  it('takes the new cost when there was none, or nothing on the shelf', () => {
    expect(averagedCost({ stock: 10, cost: undefined }, 5, 900)).toBe(900);
    expect(averagedCost({ stock: 0, cost: 1_000 }, 5, 900)).toBe(900);
  });
});
