import { useEffect, useRef } from 'react';

/**
 * A barcode scanner types a code faster than anyone can, then presses Enter.
 * Keys this close together are read as a scan.
 */
const SCAN_GAP_MS = 50;
const MIN_LENGTH = 3;

/**
 * Hears a scanner wherever focus is — the tile just tapped included — except
 * in a text field (which takes the code itself) or under an open dialog.
 * Enter that isn't the end of a scan goes to `onEnter`.
 */
export function useScanner(onScan: (code: string) => void, onEnter?: () => void): void {
  // The latest handlers, so the listener is bound once and never reads a stale tab.
  const handlers = useRef({ onScan, onEnter });
  handlers.current = { onScan, onEnter };

  useEffect(() => {
    let text = '';
    let at = 0;
    function onKeyDown(e: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      const quick = e.timeStamp - at < SCAN_GAP_MS;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        text = quick ? text + e.key : e.key;
        at = e.timeStamp;
        return;
      }
      if (e.key !== 'Enter') return;
      const code = quick && text.length >= MIN_LENGTH ? text : '';
      text = '';
      if (code) {
        e.preventDefault();
        handlers.current.onScan(code);
      } else if (!(el instanceof HTMLButtonElement)) {
        handlers.current.onEnter?.();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
