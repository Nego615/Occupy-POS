import type { Transition, Variants } from 'motion/react';

/**
 * Motion tokens. Every animation in the app takes its timing from here, the
 * way colours come from tokens.css.
 *
 * Rules (design system §7): motion answers something the person did —
 * picking, adding, bumping, paying — and never plays for decoration. It stays
 * quick (about 150ms) so a busy counter never waits on it, and it's skipped
 * when the device asks for reduced motion (MotionConfig in App).
 */

/** Fades and small shifts: content swapping in, dialogs opening. */
export const quick: Transition = { duration: 0.15, ease: [0.2, 0, 0, 1] };

/** Things that move to a new place: the active-pill fill, lines closing a gap. */
export const snap: Transition = { type: 'spring', stiffness: 700, damping: 50, mass: 0.6 };

/** New content in a panel or page: a short fade with a 4px rise. */
export const swapIn: Variants = {
  hidden: { opacity: 0, y: 4 },
  shown: { opacity: 1, y: 0, transition: quick },
};

/** A list row arriving (cart line, ticket) or leaving. */
export const rowInOut = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0, transition: quick },
  exit: { opacity: 0, x: 16, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
} as const;
