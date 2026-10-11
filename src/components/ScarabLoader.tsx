import './ScarabLoader.css';

export type ScarabLoaderProps = {
  /**
   * What the app is waiting on, e.g. "Loading orders…". Shown under the
   * drawing; with `hideLabel` it's only announced to screen readers.
   */
  label?: string;
  hideLabel?: boolean;
  /** Width of the drawing in px; height follows. 160 suits a panel, 96 a card. */
  size?: number;
  className?: string;
};

/**
 * Waiting state: a scarab rolling its ball along the ground.
 *
 * For loads the person is actually waiting on (opening a report, syncing,
 * signing in) — not as decoration. Holds still on the push pose when the
 * device asks for reduced motion. Colors come from tokens.css (ink, ink-soft,
 * line, paper); the ball has its own warm neutral so it never reads as a
 * status color.
 */
export function ScarabLoader({ label = 'Loading…', hideLabel = false, size = 160, className }: ScarabLoaderProps) {
  return (
    <div className={className ? `scarab-loader ${className}` : 'scarab-loader'} role="status" aria-live="polite">
      <svg
        className="scarab"
        viewBox="0 0 240 140"
        width={size}
        height={(size * 140) / 240}
        aria-hidden="true"
        focusable="false"
      >
      {/* Ground */}
      <line className="scarab__ground" x1="0" y1="119" x2="240" y2="119" stroke="var(--scarab-ground)" strokeWidth="2" strokeLinecap="round" strokeDasharray="10 6" />
      <g fill="var(--scarab-ground)">
        <g className="scarab__soil">
          <circle cx="12" cy="125" r="1.4" /><circle cx="46" cy="129" r="1" /><circle cx="78" cy="124.5" r="1.8" />
          <circle cx="118" cy="128" r="1.2" /><circle cx="150" cy="125" r="1" /><circle cx="186" cy="129.5" r="1.6" />
          <circle cx="222" cy="125.5" r="1.2" />
          <circle cx="252" cy="125" r="1.4" /><circle cx="286" cy="129" r="1" /><circle cx="318" cy="124.5" r="1.8" />
          <circle cx="358" cy="128" r="1.2" /><circle cx="390" cy="125" r="1" /><circle cx="426" cy="129.5" r="1.6" />
          <circle cx="462" cy="125.5" r="1.2" />
        </g>
      </g>

      {/* Dung ball */}
      <g transform="translate(152 92)">
        <circle r="26" fill="var(--scarab-ball)" />
        <g className="scarab__grain" fill="none" stroke="var(--scarab-ball-grain)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M-12 -15 q4 -3.5 8.5 -1.7" />
          <path d="M5 -20 q5 1 7.5 5" />
          <path d="M12 2 q3.4 4 1.7 9" />
          <path d="M-17 5 q1 5 5 7.5" />
          <path d="M-2 10 q4 1.7 7 0" />
          <path d="M-3.4 -3.4 q2.5 -2.5 6 -1" />
          <circle cx="17" cy="-8.5" r="1.2" fill="var(--scarab-ball-grain)" stroke="none" />
          <circle cx="-18.5" cy="-5" r="1.2" fill="var(--scarab-ball-grain)" stroke="none" />
          <circle cx="3.4" cy="20" r="1.2" fill="var(--scarab-ball-grain)" stroke="none" />
        </g>
        {/* flat shade, stays put while the grain turns */}
        <path d="M18.4 -18.4 A26 26 0 0 1 -18.4 18.4 A30 30 0 0 0 18.4 -18.4 Z" fill="var(--scarab-ball-shade)" opacity="0.6" />
      </g>

      {/* Scarab, head down, walking backwards and pushing with its hind legs */}
      <g className="scarab__bob">
        <g transform="translate(105.4 90) rotate(-28) scale(1.25)" strokeLinecap="round" strokeLinejoin="round" fill="none">
          {/* far-side legs (softer ink, opposite phase) */}
          <g stroke="var(--scarab-ink-far)" strokeWidth="2.2">
            <g transform="translate(-12 6)"><g className="scarab__leg scarab__leg--b"><path d="M0 0 L-1 8 L-9 6" /></g></g>
            <g transform="translate(0 7)"><g className="scarab__leg"><path d="M0 0 L11 7 L9 16" /></g></g>
            <g transform="translate(13 7)"><g className="scarab__leg scarab__leg--push scarab__leg--b"><path d="M0 0 L-5 8 L1.5 12" /></g></g>
          </g>

          {/* body */}
          <g fill="var(--scarab-ink)" stroke="none">
            {/* clypeus (the shovel head) */}
            <path d="M-21 -5 L-29 -3 L-33 0 L-31 2 L-34.5 4.5 L-31 6 L-33 9 L-27 9 L-21 7 Z" />
            {/* pronotum */}
            <ellipse cx="-14" cy="1" rx="9.5" ry="9.5" />
            {/* elytra */}
            <path d="M-6 7 C-8 -13 21 -16 28.5 -2 C30 5 25 8.5 17 8.5 Z" />
          </g>
          {/* elytra seam + sheen */}
          <path d="M-4.5 -1 C2 -9.5 14 -10.5 22.5 -4.5" stroke="var(--paper, #fff)" strokeOpacity="0.22" strokeWidth="1.2" />
          <path d="M-7 -1.5 L-6 5.5" stroke="var(--paper, #fff)" strokeOpacity="0.22" strokeWidth="1" />
          {/* antenna */}
          <path d="M-25 -3 L-28 -8.5" stroke="var(--scarab-ink)" strokeWidth="1.3" />
          <circle cx="-28.6" cy="-9.6" r="1.6" fill="var(--scarab-ink)" stroke="none" />

          {/* near-side legs */}
          <g stroke="var(--scarab-ink)" strokeWidth="2.4">
            <g transform="translate(-16 8)"><g className="scarab__leg"><path d="M0 0 L-2 8 L-10 4" /></g></g>
            <g transform="translate(-4 9)"><g className="scarab__leg scarab__leg--b"><path d="M0 0 L10 8 L6 15.5" /></g></g>
            {/* hind leg raised up over the back and planted on the ball */}
            <g transform="translate(18 4)"><g className="scarab__leg scarab__leg--push"><path d="M0 0 L6 -20 L13 -6" /></g></g>
          </g>
        </g>
      </g>
      </svg>
      <span className={hideLabel ? 'sr-only' : 'scarab-loader__label'}>{label}</span>
    </div>
  );
}
