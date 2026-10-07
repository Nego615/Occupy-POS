import { useEffect, useRef } from 'react';

/** Matches Inventory.css: below this the side panel stacks above its list. */
const STACKED = '(max-width: 1180px)';

/**
 * Brings a list page's side panel into view when a new row is picked — but
 * only where the panel is stacked above the list, out of sight of a row
 * picked further down. Side by side, it's already on screen.
 */
export function useRevealPanel<T extends HTMLElement>(selectedId: string | null) {
  const ref = useRef<T>(null);
  const first = useRef(true);
  useEffect(() => {
    // The page opening on a selection isn't a pick.
    if (first.current) {
      first.current = false;
      return;
    }
    if (!selectedId || !ref.current || !window.matchMedia(STACKED).matches) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }, [selectedId]);
  return ref;
}
