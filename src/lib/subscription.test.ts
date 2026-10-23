import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isLocked, readShop, subscriptionState, type ShopSubscription } from './subscription';

const now = new Date('2026-10-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
const shop = (patch: Partial<ShopSubscription>): ShopSubscription => ({
  name: 'Kahawa',
  paid_until: at(30),
  grace_days: 7,
  suspended: false,
  ...patch,
});

describe('subscriptionState', () => {
  it('is active with more than a week to go', () => {
    expect(subscriptionState(shop({ paid_until: at(30) }), now)).toMatchObject({ status: 'active', daysLeft: 30 });
    expect(subscriptionState(shop({ paid_until: at(7.5) }), now).status).toBe('active');
  });

  it('warns in the last week', () => {
    expect(subscriptionState(shop({ paid_until: at(7) }), now)).toMatchObject({ status: 'expiring', daysLeft: 7 });
    expect(subscriptionState(shop({ paid_until: at(0.1) }), now)).toMatchObject({ status: 'expiring', daysLeft: 1 });
  });

  it('counts down the grace days once lapsed', () => {
    expect(subscriptionState(shop({ paid_until: at(0) }), now)).toMatchObject({ status: 'grace', daysLeft: 7 });
    expect(subscriptionState(shop({ paid_until: at(-6.5) }), now)).toMatchObject({ status: 'grace', daysLeft: 1 });
  });

  it('locks when the grace days run out', () => {
    expect(subscriptionState(shop({ paid_until: at(-7) }), now)).toMatchObject({ status: 'locked', daysLeft: null });
    expect(subscriptionState(shop({ paid_until: at(-1), grace_days: 0 }), now).status).toBe('locked');
  });

  it('never ends without an end date', () => {
    expect(subscriptionState(shop({ paid_until: null }), now)).toMatchObject({ status: 'active', daysLeft: null });
  });

  it('carries the free trial through every state', () => {
    expect(subscriptionState(shop({ trial: true, paid_until: at(10) }), now)).toEqual({ status: 'active', daysLeft: 10, trial: true });
    expect(subscriptionState(shop({ trial: true, paid_until: at(-2) }), now)).toMatchObject({ status: 'grace', trial: true });
    expect(subscriptionState(shop({ paid_until: at(10) }), now).trial).toBe(false);
  });

  it('puts suspension above the dates', () => {
    expect(subscriptionState(shop({ suspended: true, paid_until: at(300) }), now).status).toBe('suspended');
  });
});

describe('isLocked', () => {
  it('locks only locked and suspended shops', () => {
    expect(isLocked({ status: 'locked' })).toBe(true);
    expect(isLocked({ status: 'suspended' })).toBe(true);
    expect(isLocked({ status: 'grace' })).toBe(false);
    expect(isLocked({ status: 'expiring' })).toBe(false);
  });
});

/**
 * Just enough of a Supabase client for readShop: who's signed in, and what
 * each read of `shops` answers, in turn.
 */
function fakeClient(userId: string | null, answers: { data: ShopSubscription | null; error: { code: string } | null }[]) {
  const columns: string[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
    from: () => ({
      select: (cols: string) => {
        columns.push(cols);
        return { eq: () => ({ maybeSingle: async () => answers.shift()! }) };
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, columns };
}

describe('readShop', () => {
  it('returns the row of a registered shop', async () => {
    const { client } = fakeClient('store-1', [{ data: shop({}), error: null }]);
    expect(await readShop(client, 'store-1')).toEqual(shop({}));
  });

  it('returns null for an account with no shop on the platform', async () => {
    const { client } = fakeClient('store-1', [{ data: null, error: null }]);
    expect(await readShop(client, 'store-1')).toBeNull();
  });

  it('can’t tell offline or without the platform tables', async () => {
    const { client } = fakeClient('store-1', [{ data: null, error: { code: 'PGRST205' } }]);
    expect(await readShop(client, 'store-1')).toBeUndefined();
  });

  it('can’t tell when signed in as another account, or not at all', async () => {
    expect(await readShop(fakeClient('store-2', [{ data: null, error: null }]).client, 'store-1')).toBeUndefined();
    expect(await readShop(fakeClient(null, [{ data: null, error: null }]).client, 'store-1')).toBeUndefined();
  });

  it('reads the business type with the rest', async () => {
    const { client, columns } = fakeClient('store-1', [{ data: shop({ business_type: 'retail' }), error: null }]);
    expect((await readShop(client, 'store-1'))?.business_type).toBe('retail');
    expect(columns[0]).toContain('business_type');
  });

  it('reads without the business type on a database from before business types', async () => {
    const { client, columns } = fakeClient('store-1', [
      { data: null, error: { code: '42703' } },
      { data: shop({}), error: null },
    ]);
    expect(await readShop(client, 'store-1')).toEqual(shop({}));
    expect(columns[1]).not.toContain('business_type');
    expect(columns[1]).toContain('trial');
  });

  it('reads without the trial column on a database from before trials', async () => {
    const { client, columns } = fakeClient('store-1', [
      { data: null, error: { code: '42703' } },
      { data: null, error: { code: '42703' } },
      { data: null, error: null },
    ]);
    expect(await readShop(client, 'store-1')).toBeNull();
    expect(columns[2]).not.toContain('trial');
  });
});
