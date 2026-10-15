import { describe, expect, it } from 'vitest';
import { hasPermission, hasRole, homePath, rolesLabel, rolesOf } from './staff';

const serverAndCounter = { role: 'server' as const, extraRoles: ['frontdesk' as const], active: true };

describe('staff with more than one role', () => {
  it('can do what any of their roles allows', () => {
    expect(hasPermission(serverAndCounter, 'register')).toBe(true); // server
    expect(hasPermission(serverAndCounter, 'payments')).toBe(true); // counter
    expect(hasPermission(serverAndCounter, 'allTabs')).toBe(true); // counter
    expect(hasPermission(serverAndCounter, 'reports')).toBe(false); // neither
  });

  it('gets nothing once deactivated', () => {
    expect(hasPermission({ ...serverAndCounter, active: false }, 'register')).toBe(false);
  });

  it('lands where their main role does', () => {
    expect(homePath(serverAndCounter)).toBe('/counter/register');
    const counterAndServer = { role: 'frontdesk' as const, extraRoles: ['server' as const], active: true };
    expect(homePath(counterAndServer)).toBe('/desk');
  });

  it('lists the main role first, without repeats', () => {
    const m = { role: 'server' as const, extraRoles: ['frontdesk' as const, 'server' as const] };
    expect(rolesOf(m)).toEqual(['server', 'frontdesk']);
    expect(rolesLabel(m)).toBe('Server + Counter');
    expect(hasRole(m, 'frontdesk')).toBe(true);
    expect(hasRole({ role: 'cook' }, 'server')).toBe(false);
  });

  it('lets an extra cook role edit the kitchen menu when Settings allows', () => {
    const m = { role: 'server' as const, extraRoles: ['cook' as const], active: true };
    expect(hasPermission(m, 'menu', { kitchenMenu: true })).toBe(true);
    expect(hasPermission(m, 'menu', { kitchenMenu: false })).toBe(false);
  });
});
