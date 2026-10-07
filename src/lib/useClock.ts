import { useEffect, useState } from 'react';

export function formatTime(d: Date): string {
  const hours = d.getHours() % 12 || 12;
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Live wall clock for the top bar. Ticks every 15s, like the mockup. */
export function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  return { date: formatDate(now), time: formatTime(now) };
}

/** Epoch ms, re-read every `everyMs` — for timers that count up in seconds. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);

  return now;
}

