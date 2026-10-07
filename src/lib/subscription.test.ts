import { describe, expect, it } from 'vitest';
import { isLocked, subscriptionState, type ShopSubscription } from './subscription';

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
