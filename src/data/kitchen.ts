import { lineDishes, type CartLine } from '../lib/cart';

/** What a tab has already sent to the kitchen, per item and note. */
export type SentLine = {
  itemId: string;
  name: string;
  qty: number;
  /** "No onions" — the same item with different notes is made separately. */
  note?: string;
  /** The sides it goes out with, by name — chicken with chips isn't chicken with rice. */
  addOns?: string[];
};

export type DishId = Pick<SentLine, 'itemId' | 'name' | 'note' | 'addOns'>;

/** Sent lines match on the item, its name — a half isn't a whole — its note, and its sides. */
export function sameDish(a: DishId, b: DishId): boolean {
  return (
    a.itemId === b.itemId &&
    a.name === b.name &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.addOns ?? []).join('|') === (b.addOns ?? []).join('|')
  );
}

/**
 * Every item on the tab as the kitchen counts it — by item, note, and sides,
 * set meals by their picks. Sides go out with their dish, not as dishes of their own.
 */
function dishes(cart: CartLine[], keep: (itemId: string) => boolean = () => true): SentLine[] {
  const out: SentLine[] = [];
  for (const line of cart) {
    for (const item of lineDishes(line)) {
      if (!keep(item.itemId)) continue;
      const dish = {
        itemId: item.itemId,
        name: item.name,
        qty: line.qty,
        ...(line.note ? { note: line.note } : {}),
        ...(item.addOns.length > 0 ? { addOns: item.addOns.map((a) => a.name) } : {}),
      };
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
  addOns?: string[];
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
  lines: TicketLine[];
  /** Epoch ms the kitchen cleared it off the screen; null while it's still up. */
  bumpedAt: number | null;
  /** Epoch ms a cook started on it. Absent until then. */
  startedAt?: number;
  /** Whoever was signed in on the kitchen screen when it was started. */
  startedBy?: string;
};

/** `ticket` marked as being worked on, by `by`. One already started keeps its start. */
export function startTicket(ticket: KitchenTicket, by?: string, at = Date.now()): KitchenTicket {
  if (ticket.startedAt !== undefined) return ticket;
  return { ...ticket, startedAt: at, ...(by ? { startedBy: by } : {}) };
}

/** `ticket` back to not started — for a start tapped by mistake. */
export function unstartTicket(ticket: KitchenTicket): KitchenTicket {
  const { startedAt: _at, startedBy: _by, ...rest } = ticket;
  return rest;
}

function sentQty(sent: SentLine[], dish: DishId): number {
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
