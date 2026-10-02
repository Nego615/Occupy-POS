import { lineItems, type CartLine } from '../lib/cart';
import type { OrderType } from './orders';

/** What a tab has already sent to the kitchen, per item and note. */
export type SentLine = {
  itemId: string;
  name: string;
  qty: number;
  /** "No onions" — the same item with different notes is made separately. */
  note?: string;
};

/** Sent lines match on the item and its note. */
function sameDish(a: Pick<SentLine, 'itemId' | 'note'>, b: Pick<SentLine, 'itemId' | 'note'>): boolean {
  return a.itemId === b.itemId && (a.note ?? '') === (b.note ?? '');
}

/** Every item on the tab as the kitchen counts it — by item and note, set meals by their picks. */
function dishes(cart: CartLine[], keep: (itemId: string) => boolean = () => true): SentLine[] {
  const out: SentLine[] = [];
  for (const line of cart) {
    for (const item of lineItems(line)) {
      if (!keep(item.itemId)) continue;
      const dish = { itemId: item.itemId, name: item.name, qty: line.qty, ...(line.note ? { note: line.note } : {}) };
      const existing = out.find((d) => sameDish(d, dish));
      if (existing) existing.qty += line.qty;
      else out.push(dish);
    }
  }
  return out;
}

export type TicketLine = {
  itemId: string;
  name: string;
  qty: number;
  note?: string;
  /** Crossed off by the kitchen. Bumping doesn't need every line done. */
  done: boolean;
};

export type KitchenTicket = {
  id: number;
  orderId: number;
  /** The tab's name when it was sent — a ticket is a printed chit, it doesn't follow renames. */
  tabName: string;
  /** Epoch ms. Drives the ticket's timer. */
  sentAt: number;
  /** 1 for a tab's first send, 2 for items added and sent later, and so on. */
  fire: number;
  /** A void tells the kitchen to stop making items taken off a tab after they were sent. */
  kind: 'order' | 'void';
  /** Eat in, take away, or delivery — how the kitchen packs it. */
  orderType?: OrderType;
  lines: TicketLine[];
  /** Epoch ms the kitchen cleared it off the screen; null while it's still up. */
  bumpedAt: number | null;
};

function sentQty(sent: SentLine[], dish: Pick<SentLine, 'itemId' | 'note'>): number {
  return sent.find((s) => sameDish(s, dish))?.qty ?? 0;
}

/**
 * Kitchen items on the tab that the kitchen hasn't seen yet — the difference
 * between what's on the tab and what was already sent. Set meals count by
 * their picks, so a meal's main goes to the kitchen like any other.
 */
export function unsentLines(
  cart: CartLine[],
  sent: SentLine[],
  isKitchenItem: (itemId: string) => boolean,
): SentLine[] {
  return dishes(cart, isKitchenItem)
    .map((l) => ({ ...l, qty: l.qty - sentQty(sent, l) }))
    .filter((l) => l.qty > 0);
}

/** `sent` once `lines` have gone to the kitchen. */
export function addSent(sent: SentLine[], lines: SentLine[]): SentLine[] {
  const next = sent.map((s) => ({ ...s }));
  for (const line of lines) {
    const existing = next.find((s) => sameDish(s, line));
    if (existing) existing.qty += line.qty;
    else next.push({ ...line });
  }
  return next;
}

/**
 * Checks what was sent against the tab's new contents. Anything sent that's
 * no longer on the tab comes back as a void, and `sent` is trimmed to match.
 */
export function takeVoids(
  cart: CartLine[],
  sent: SentLine[],
): { sent: SentLine[]; voids: SentLine[] } {
  const voids: SentLine[] = [];
  const kept: SentLine[] = [];
  const onTabNow = dishes(cart);
  for (const s of sent) {
    const onTab = onTabNow.find((d) => sameDish(d, s))?.qty ?? 0;
    if (onTab < s.qty) voids.push({ ...s, qty: s.qty - onTab });
    if (onTab > 0) kept.push({ ...s, qty: Math.min(s.qty, onTab) });
  }
  return { sent: kept, voids };
}

export function ticketLines(lines: SentLine[]): TicketLine[] {
  return lines.map((l) => ({ ...l, done: false }));
}

/** m:ss since `since` — "7:04", "72:10". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Tickets already on the kitchen screen when the app opens: Table 2's Turkey
 * Club, running a little long, and one Table 7 already cleared.
 */
export function seedTickets(now = Date.now()): KitchenTicket[] {
  const min = 60_000;
  return [
    {
      id: 2,
      orderId: 1045,
      tabName: 'Table 2',
      sentAt: now - 12 * min - 20_000,
      fire: 1,
      kind: 'order',
      lines: [{ itemId: 'turkey-club', name: 'Turkey Club', qty: 1, done: false }],
      bumpedAt: null,
    },
    {
      id: 1,
      orderId: 1043,
      tabName: 'Table 7',
      sentAt: now - 31 * min,
      fire: 1,
      kind: 'order',
      lines: [{ itemId: 'avo-toast', name: 'Avocado Toast', qty: 1, done: true }],
      bumpedAt: now - 24 * min,
    },
  ];
}
