/**
 * Notes a customer is likely to hand over for `amount`: the next round
 * figures up from it. Shilling currencies use shilling notes.
 */
export function quickCash(amount: number, decimals: number): number[] {
  const steps = decimals === 0 ? [1_000, 5_000, 10_000, 50_000] : [1, 5, 10, 20, 50, 100];
  const out = new Set<number>();
  for (const step of steps) {
    const up = Math.ceil(amount / step) * step;
    if (up > amount) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}
