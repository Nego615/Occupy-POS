import { describe, expect, it } from 'vitest';
import {
  changeGiven,
  hydrateOrder,
  orderDiscount,
  orderNetTotal,
  orderRefundTotal,
  orderSubtotal,
  orderTotal,
  paidAmount,
  paymentLabel,
  refundValue,
  type OrderRecord,
} from '../data/orders';
import { hashPin, pinMatches, uniquePin } from '../data/staff';
import { unsentLines, takeVoids } from '../data/kitchen';
import {
  addLine,
  computeTotals,
  customLine,
  discountOff,
  editLine,
  setLineDiscount,
  setLineNote,
  type CartLine,
} from './cart';
import { byPayment, ledger } from './reports';
import { quickCash } from './tender';
import { nextSeq } from './usePersist';

const latte: CartLine = { key: 'latte', itemId: 'latte', name: 'Latte', unitPrice: 6_500, qty: 2 };
const toast: CartLine = { key: 'toast', itemId: 'toast', name: 'Toast', unitPrice: 9_000, qty: 1 };

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 1,
    name: 'Walk-in',
    status: 'paid',
    at: new Date().toISOString(),
    lines: [
      { itemId: 'latte', name: 'Latte', qty: 2, unitPrice: 6_500 },
      { itemId: 'toast', name: 'Toast', qty: 1, unitPrice: 9_000 },
    ],
    tax: 3_960, // 18% of 22,000
    tip: 2_000,
    payments: [{ method: 'card', amount: 27_960 }],
    ...over,
  };
}

describe('cart totals', () => {
  it('adds tax on top of the lines', () => {
    const t = computeTotals([latte, toast], 0.18);
    expect(t.subtotal).toBe(22_000);
    expect(t.tax).toBe(3_960);
    expect(t.total).toBe(25_960);
    expect(t.itemCount).toBe(3);
  });

  it('takes a tab discount off before tax', () => {
    const t = computeTotals([latte, toast], 0.18, { kind: 'percent', value: 10 });
    expect(t.orderDiscount).toBe(2_200);
    expect(t.subtotal).toBe(19_800);
    expect(t.tax).toBe(3_564);
    expect(t.discount).toBe(2_200);
  });

  it('never discounts below zero', () => {
    expect(discountOff(5_000, { kind: 'amount', value: 9_000 })).toBe(5_000);
    expect(discountOff(5_000, { kind: 'percent', value: 150 })).toBe(5_000);
  });
});

describe('line discounts and notes', () => {
  it('discounts a line and can take it off again', () => {
    const discounted = setLineDiscount([latte], 'latte', { kind: 'percent', value: 10 });
    expect(discounted[0].unitPrice).toBe(5_850);
    expect(discounted[0].listPrice).toBe(6_500);
    expect(discounted[0].promo).toBe('10% off');

    const restored = setLineDiscount(discounted, discounted[0].key, null);
    expect(restored[0]).toMatchObject({ unitPrice: 6_500, key: 'latte' });
    expect(restored[0].listPrice).toBeUndefined();
    expect(restored[0].promo).toBeUndefined();
  });

  it('keeps a promotion under a manual discount', () => {
    const promo: CartLine = { ...latte, unitPrice: 5_000, listPrice: 6_500, promo: 'Happy Hour' };
    const [line] = setLineDiscount([promo], 'latte', { kind: 'amount', value: 1_000 });
    expect(line.unitPrice).toBe(4_000);
    expect(line.listPrice).toBe(6_500);
    expect(line.promo).toBe('Happy Hour + TSh 1,000 off');
  });

  it('a noted line stays apart from plain ones, and merges with its twin', () => {
    let lines = setLineNote([latte], 'latte', '  oat   milk ');
    expect(lines[0].note).toBe('oat milk');
    lines = addLine(lines, { key: 'latte', itemId: 'latte', name: 'Latte', unitPrice: 6_500 });
    expect(lines).toHaveLength(2);
    // Giving the plain line the same note folds it into the first.
    lines = setLineNote(lines, 'latte', 'oat milk');
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(3);
  });

  it('edits note and discount in one go', () => {
    const [line] = editLine([latte], 'latte', 'extra hot', { kind: 'percent', value: 50 });
    expect(line).toMatchObject({ note: 'extra hot', unitPrice: 3_250 });
  });

  it('custom amounts get their own lines', () => {
    const a = customLine('', 2_500);
    const b = customLine('Corkage', 2_500);
    expect(a.name).toBe('Custom amount');
    expect(a.key).not.toBe(b.key);
  });
});

describe('kitchen with notes', () => {
  const isKitchen = () => true;

  it('sends the same dish with different notes separately', () => {
    const lines = setLineNote([{ ...toast, qty: 2 }], 'toast', 'no butter');
    const withPlain = addLine(lines, { key: 'toast', itemId: 'toast', name: 'Toast', unitPrice: 9_000 });
    const unsent = unsentLines(withPlain, [], isKitchen);
    expect(unsent).toEqual([
      { itemId: 'toast', name: 'Toast', qty: 2, note: 'no butter' },
      { itemId: 'toast', name: 'Toast', qty: 1 },
    ]);
  });

  it('voids a sent dish whose note changed', () => {
    const sent = [{ itemId: 'toast', name: 'Toast', qty: 1 }];
    const next = setLineNote([toast], 'toast', 'gluten free');
    const { voids, sent: kept } = takeVoids(next, sent);
    expect(voids).toEqual([{ itemId: 'toast', name: 'Toast', qty: 1 }]);
    expect(kept).toEqual([]);
  });
});

describe('tender', () => {
  it('works out change across payments', () => {
    const payments = [
      { method: 'card' as const, amount: 10_000 },
      { method: 'cash' as const, amount: 7_500, tendered: 10_000 },
    ];
    expect(paidAmount(payments)).toBe(17_500);
    expect(changeGiven(payments)).toBe(2_500);
    expect(paymentLabel(payments)).toBe('Split · Card + Cash');
    expect(paymentLabel([{ method: 'mobile', amount: 1, ref: 'QK12' }])).toBe('Mobile money ·QK12');
  });

  it('offers round notes above the amount', () => {
    expect(quickCash(7_500, 0)).toEqual([8_000, 10_000, 50_000]);
    expect(quickCash(12.4, 2)).toEqual([13, 15, 20]);
  });
});

describe('refunds', () => {
  it('values a partial refund at the discounted price plus its tax', () => {
    const o = order({ discount: 2_200, tax: 3_564 }); // 10% off 22,000
    const v = refundValue(o, [{ index: 0, qty: 1 }]);
    expect(v.subtotal).toBe(5_850);
    expect(v.tax).toBe(1_053);
    expect(v.amount).toBe(6_903);
  });

  it('nets partial refunds out of sales and counts them as refunds', () => {
    const o = order({
      refunds: [
        {
          id: 'R1-1',
          at: new Date().toISOString(),
          lines: [{ index: 1, qty: 1 }],
          subtotal: 9_000,
          tax: 1_620,
          amount: 10_620,
          reason: 'Wrong item',
          by: 'priya',
          restocked: false,
        },
      ],
    });
    expect(orderNetTotal(o)).toBe(27_960 - 10_620);
    expect(orderRefundTotal(o)).toBe(10_620);
    const l = ledger([hydrateOrder(o)]);
    expect(l.itemSales).toBe(13_000);
    expect(l.tax).toBe(2_340);
    expect(l.refunds).toBe(10_620);
    expect(l.refundCount).toBe(1);
  });

  it('counts an old full refund at its whole value', () => {
    const o = order({ status: 'refunded', tip: 0 });
    expect(orderRefundTotal(o)).toBe(orderTotal(o));
    expect(orderNetTotal(o)).toBe(0);
  });
});

describe('order discounts', () => {
  it('reports the order discount with line deals', () => {
    const o = order({
      lines: [{ name: 'Latte', qty: 1, unitPrice: 5_000, listPrice: 6_500 }],
      discount: 500,
      tax: 810,
      tip: 0,
    });
    expect(orderSubtotal(o)).toBe(4_500);
    expect(orderDiscount(o)).toBe(2_000);
    expect(orderTotal(o)).toBe(5_310);
  });
});

describe('payments report', () => {
  it('splits a split bill across its methods', () => {
    const o = hydrateOrder(
      order({
        payments: [
          { method: 'card', amount: 13_980 },
          { method: 'cash', amount: 13_980, tendered: 15_000 },
        ],
      }),
    );
    const rows = byPayment([o]);
    expect(rows.map((r) => r.label).sort()).toEqual(['Card', 'Cash']);
    expect(rows.every((r) => r.collected === 13_980 && r.share === 0.5)).toBe(true);
  });
});

describe('order timestamps', () => {
  it('works out days ago and labels from the saved time', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(14, 14, 0, 0);
    const o = hydrateOrder(order({ at: twoDaysAgo.toISOString() }));
    expect(o.daysAgo).toBe(2);
    expect(o.time).toMatch(/^\w{3} 2:14 PM$/);
    expect(o.method).toBe('Card');
  });
});

describe('PINs', () => {
  it('checks a PIN against its salted hash', () => {
    const member = { id: 'priya', pinHash: hashPin('priya', '4821') };
    expect(pinMatches(member, '4821')).toBe(true);
    expect(pinMatches(member, '4822')).toBe(false);
    // Same PIN, different person: different hash.
    expect(hashPin('marcus', '4821')).not.toBe(member.pinHash);
  });

  it('never hands out a PIN someone already uses', () => {
    const staff = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, pinHash: hashPin(`s${i}`, String(i).padStart(4, '0')) }));
    for (let n = 0; n < 20; n++) {
      const pin = uniquePin(staff);
      expect(staff.some((m) => pinMatches(m, pin))).toBe(false);
    }
  });
});

describe('id sequences', () => {
  it('carries on from the highest saved id', () => {
    expect(nextSeq(['PO-1004', 'PO-1012', 'X-9'], 'PO-', 1005)).toBe(1013);
    expect(nextSeq([], 'BILL-', 4)).toBe(4);
  });
});
