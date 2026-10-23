import { usePos } from '../../lib/store';

/**
 * Where the signed-in person's own screen is in a retail shop: the till for
 * anyone who sells, the counter for payments only, else the back office.
 * There's no kitchen to send anyone to.
 */
export function useRetailHome(): string {
  const { me, can } = usePos();
  if (!me) return '/sign-in';
  if (can('register')) return '/counter/register';
  if (can('payments')) return '/desk';
  return '/admin';
}
