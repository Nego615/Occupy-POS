import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CatalogItem } from '../data/catalog';
import {
  PURCHASE_ORDERS,
  SUPPLIERS,
  SUPPLIER_BILLS,
  todayIso,
  type CountDraft,
  type PaymentMethod,
  type StockCount,
  type PurchaseOrder,
  type StockMovement,
  type Supplier,
  type SupplierBill,
} from '../data/inventory';
import type { StaffMember } from '../data/staff';
import { round } from './cart';
import type { PosRepository, Snapshot } from './persist';
import { nextSeq, restored, useNextId, usePersist, useRemote } from './usePersist';
import {
  applyMovements,
  billStatus,
  newBill,
  openingMovements,
  receiveAgainst,
  type Receipt,
  type StockEntry,
} from './inventory';

export type AdjustInput = { mode: 'count'; counted: number } | { mode: 'change'; change: number };

export type PurchaseDraft = {
  /** Present when editing an existing draft. */
  id?: string;
  supplierId: string;
  lines: { itemId: string; qty: number; unitCost: number }[];
  expectedAt?: string;
  notes?: string;
};

export type InventoryStore = {
  /** The stock ledger, newest first. */
  movements: StockMovement[];
  suppliers: Supplier[];
  /** Newest first. */
  purchaseOrders: PurchaseOrder[];
  /** Newest first. */
  bills: SupplierBill[];
  /** Applies stock changes and logs them. The only way stock moves. */
  logStock: (entries: StockEntry[]) => void;
  /** Logs a brand-new item's starting count. */
  logNewItem: (item: CatalogItem) => void;
  /** A hand adjustment: set to a counted number, or add/remove units. */
  adjustStock: (
    itemId: string,
    input: AdjustInput,
    reason: 'waste' | 'correction' | 'count',
    note?: string,
  ) => void;
  addSupplier: (data: Omit<Supplier, 'id'>) => Supplier;
  updateSupplier: (id: string, patch: Partial<Omit<Supplier, 'id'>>) => void;
  /** Creates a draft purchase order, or updates one that's still a draft. */
  savePurchaseOrder: (draft: PurchaseDraft) => PurchaseOrder;
  /** Draft → ordered. */
  placePurchaseOrder: (id: string) => void;
  /** Refused once anything has been received against it. */
  cancelPurchaseOrder: (id: string) => boolean;
  /**
   * Takes a delivery: stock in, item costs re-averaged, and a bill for what
   * arrived, due on the supplier's terms. Returns the bill.
   */
  receiveDelivery: (poId: string, receipts: Receipt[], invoiceRef: string) => SupplierBill | null;
  /** Records a payment against a bill; capped at what's still owed. */
  recordBillPayment: (billId: string, amount: number, method: PaymentMethod) => void;
  /** The count in progress, if one's been started. Survives leaving the page. */
  countDraft: CountDraft | null;
  /** Posted counts, newest first. */
  stockCounts: StockCount[];
  startCount: (scope: string, itemIds: string[]) => void;
  /** Records a counted number for an item, or clears it with null. */
  setCounted: (itemId: string, counted: number | null) => void;
  /**
   * Posts the count: every counted item that differs from the system gets a
   * stock-count movement. Uncounted items are left alone. Returns the record.
   */
  postCount: () => StockCount | null;
  discardCount: () => void;
};

/**
 * Inventory state and actions, called from PosProvider — which owns the
 * catalog and hands it in, so stock numbers and the ledger change together.
 */
export function useInventory(
  catalog: CatalogItem[],
  setCatalog: Dispatch<SetStateAction<CatalogItem[]>>,
  me: StaffMember | null,
  repo: PosRepository,
  snapshot: Snapshot,
): InventoryStore {
  const [movements, setMovements] = useState<StockMovement[]>(() =>
    restored(snapshot, 'movements', () => openingMovements(catalog)),
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => restored(snapshot, 'suppliers', SUPPLIERS));
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() =>
    restored(snapshot, 'purchaseOrders', PURCHASE_ORDERS),
  );
  const [bills, setBills] = useState<SupplierBill[]>(() => restored(snapshot, 'bills', SUPPLIER_BILLS));
  const [countDraft, setCountDraft] = useState<CountDraft | null>(() =>
    restored(snapshot, 'countDraft', null),
  );
  const [stockCounts, setStockCounts] = useState<StockCount[]>(() =>
    restored(snapshot, 'stockCounts', []),
  );
  // Numbering carries on from whatever was saved — shared across screens when synced.
  const nextPo = useNextId(repo, 'po', nextSeq(purchaseOrders.map((p) => p.id), 'PO-', 1005));
  const nextBill = useNextId(repo, 'bill', nextSeq(bills.map((b) => b.id), 'BILL-', 4));
  const nextPayment = useNextId(
    repo,
    'payment',
    nextSeq(bills.flatMap((b) => b.payments.map((p) => p.id)), 'PAY-', 3),
  );
  const nextCount = useNextId(repo, 'count', nextSeq(stockCounts.map((c) => c.id), 'COUNT-'));

  usePersist(repo, 'movements', movements);
  usePersist(repo, 'suppliers', suppliers);
  usePersist(repo, 'purchaseOrders', purchaseOrders);
  usePersist(repo, 'bills', bills);
  usePersist(repo, 'countDraft', countDraft);
  usePersist(repo, 'stockCounts', stockCounts);

  useRemote(repo, 'movements', setMovements);
  useRemote(repo, 'suppliers', setSuppliers);
  useRemote(repo, 'purchaseOrders', setPurchaseOrders);
  useRemote(repo, 'bills', setBills);
  useRemote(repo, 'countDraft', setCountDraft);
  useRemote(repo, 'stockCounts', setStockCounts);

  // With several screens selling at once, each writes its own idea of an
  // item's stock. The ledger is the agreed record, so on-hand numbers are
  // re-added from it — every screen lands on the same figure.
  const shared = repo.subscribe !== undefined;
  useEffect(() => {
    if (!shared) return;
    const ledger = new Map<string, number>();
    for (const m of movements) ledger.set(m.itemId, (ledger.get(m.itemId) ?? 0) + m.change);
    setCatalog((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const stock = ledger.has(item.id) ? Math.max(0, ledger.get(item.id)!) : item.stock;
        if (stock === item.stock) return item;
        changed = true;
        return { ...item, stock };
      });
      return changed ? next : prev;
    });
  }, [shared, movements, setCatalog]);

  const logStock = useCallback(
    (entries: StockEntry[]) => {
      const result = applyMovements(catalog, entries, me?.id);
      if (result.movements.length === 0) return;
      setCatalog(result.catalog);
      setMovements((prev) => [...result.movements.reverse(), ...prev]);
    },
    [catalog, setCatalog, me],
  );

  const logNewItem = useCallback(
    (item: CatalogItem) => {
      setMovements((prev) => [
        {
          id: `mv-new-${item.id}`,
          itemId: item.id,
          itemName: item.name,
          change: item.stock,
          stockAfter: item.stock,
          reason: 'new-item',
          staffId: me?.id,
          date: todayIso(),
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        },
        ...prev,
      ]);
    },
    [me],
  );

  const adjustStock = useCallback(
    (itemId: string, input: AdjustInput, reason: 'waste' | 'correction' | 'count', note?: string) => {
      const item = catalog.find((i) => i.id === itemId);
      if (!item) return;
      const change = input.mode === 'count' ? input.counted - item.stock : input.change;
      logStock([{ itemId, change, reason, note: note?.trim() || undefined }]);
    },
    [catalog, logStock],
  );

  const addSupplier = useCallback((data: Omit<Supplier, 'id'>) => {
    const supplier = { ...data, id: `sup-${Date.now().toString(36)}` };
    setSuppliers((prev) => [...prev, supplier]);
    return supplier;
  }, []);

  const updateSupplier = useCallback((id: string, patch: Partial<Omit<Supplier, 'id'>>) => {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const savePurchaseOrder = useCallback(
    (draft: PurchaseDraft) => {
      const lines = draft.lines
        .filter((l) => l.qty > 0)
        .map((l) => ({
          itemId: l.itemId,
          name: catalog.find((i) => i.id === l.itemId)?.name ?? l.itemId,
          qty: l.qty,
          unitCost: l.unitCost,
          received: 0,
        }));
      const existing = draft.id ? purchaseOrders.find((p) => p.id === draft.id) : undefined;
      const order: PurchaseOrder =
        existing && existing.status === 'draft'
          ? { ...existing, supplierId: draft.supplierId, lines, expectedAt: draft.expectedAt, notes: draft.notes }
          : {
              id: `PO-${nextPo()}`,
              supplierId: draft.supplierId,
              status: 'draft',
              lines,
              createdAt: todayIso(),
              createdBy: me?.name ?? 'Unknown',
              expectedAt: draft.expectedAt,
              notes: draft.notes,
            };
      setPurchaseOrders((prev) =>
        existing ? prev.map((p) => (p.id === order.id ? order : p)) : [order, ...prev],
      );
      return order;
    },
    [catalog, purchaseOrders, me],
  );

  const placePurchaseOrder = useCallback((id: string) => {
    setPurchaseOrders((prev) =>
      prev.map((p) =>
        p.id === id && p.status === 'draft' ? { ...p, status: 'ordered', orderedAt: todayIso() } : p,
      ),
    );
  }, []);

  const cancelPurchaseOrder = useCallback(
    (id: string) => {
      const order = purchaseOrders.find((p) => p.id === id);
      if (!order || order.lines.some((l) => l.received > 0)) return false;
      setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'cancelled' } : p)));
      return true;
    },
    [purchaseOrders],
  );

  const receiveDelivery = useCallback(
    (poId: string, receipts: Receipt[], invoiceRef: string) => {
      const order = purchaseOrders.find((p) => p.id === poId);
      if (!order || order.status === 'cancelled' || order.status === 'draft') return null;
      const result = receiveAgainst(order, catalog, receipts);
      if (result.entries.length === 0) return null;

      // Costs first, then stock through the ledger — both from the same snapshot.
      const moved = applyMovements(result.catalog, result.entries, me?.id);
      setCatalog(moved.catalog);
      setMovements((prev) => [...moved.movements.reverse(), ...prev]);
      setPurchaseOrders((prev) => prev.map((p) => (p.id === poId ? result.order : p)));

      const terms = suppliers.find((s) => s.id === order.supplierId)?.paymentTermsDays ?? 0;
      const billNo = nextBill();
      const bill = newBill(
        order.supplierId,
        order.id,
        invoiceRef.trim() || `${order.id}-${billNo}`,
        result.amount,
        terms,
        billNo,
      );
      setBills((prev) => [bill, ...prev]);
      return bill;
    },
    [purchaseOrders, catalog, suppliers, me, setCatalog],
  );

  const startCount = useCallback(
    (scope: string, itemIds: string[]) => {
      setCountDraft({
        scope,
        startedAt: todayIso(),
        startedBy: me?.name ?? 'Unknown',
        itemIds,
        counted: {},
      });
    },
    [me],
  );

  const setCounted = useCallback((itemId: string, counted: number | null) => {
    setCountDraft((draft) => {
      if (!draft) return draft;
      const next = { ...draft.counted };
      if (counted === null) delete next[itemId];
      else next[itemId] = counted;
      return { ...draft, counted: next };
    });
  }, []);

  const postCount = useCallback(() => {
    if (!countDraft) return null;
    const id = `COUNT-${nextCount()}`;
    // Compared with stock as it is now, so sales during the count don't show as losses.
    const lines = countDraft.itemIds
      .filter((itemId) => countDraft.counted[itemId] !== undefined)
      .map((itemId) => {
        const item = catalog.find((i) => i.id === itemId);
        return item
          ? {
              itemId,
              name: item.name,
              expected: item.stock,
              counted: countDraft.counted[itemId],
              unitCost: item.cost,
            }
          : null;
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    if (lines.length === 0) return null;

    logStock(
      lines
        .filter((l) => l.counted !== l.expected)
        .map((l) => ({
          itemId: l.itemId,
          change: l.counted - l.expected,
          reason: 'count' as const,
          ref: id,
        })),
    );
    const record: StockCount = {
      id,
      scope: countDraft.scope,
      date: todayIso(),
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      by: me?.name ?? 'Unknown',
      lines,
      skipped: countDraft.itemIds.length - lines.length,
    };
    setStockCounts((prev) => [record, ...prev]);
    setCountDraft(null);
    return record;
  }, [countDraft, catalog, logStock, me]);

  const discardCount = useCallback(() => setCountDraft(null), []);

  const recordBillPayment = useCallback(
    (billId: string, amount: number, method: PaymentMethod) => {
      setBills((prev) =>
        prev.map((b) => {
          if (b.id !== billId) return b;
          const pay = round(Math.min(amount, billStatus(b).balance));
          if (pay <= 0) return b;
          return {
            ...b,
            payments: [
              ...b.payments,
              {
                id: `PAY-${nextPayment()}`,
                amount: pay,
                method,
                date: todayIso(),
                by: me?.name ?? 'Unknown',
              },
            ],
          };
        }),
      );
    },
    [me],
  );

  return useMemo(
    () => ({
      movements,
      suppliers,
      purchaseOrders,
      bills,
      logStock,
      logNewItem,
      adjustStock,
      addSupplier,
      updateSupplier,
      savePurchaseOrder,
      placePurchaseOrder,
      cancelPurchaseOrder,
      receiveDelivery,
      recordBillPayment,
      countDraft,
      stockCounts,
      startCount,
      setCounted,
      postCount,
      discardCount,
    }),
    [
      movements,
      suppliers,
      purchaseOrders,
      bills,
      logStock,
      logNewItem,
      adjustStock,
      addSupplier,
      updateSupplier,
      savePurchaseOrder,
      placePurchaseOrder,
      cancelPurchaseOrder,
      receiveDelivery,
      recordBillPayment,
      countDraft,
      stockCounts,
      startCount,
      setCounted,
      postCount,
      discardCount,
    ],
  );
}
