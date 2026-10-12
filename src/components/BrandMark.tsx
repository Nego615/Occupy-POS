/**
 * The square beside the business name. Shows the uploaded logo when there is
 * one, and the built-in mark otherwise. Decorative — the name sits next to it.
 */
export function BrandMark({ logo }: { logo: string | null }) {
  return logo ? (
    <img className="brand-mark brand-mark--logo" src={logo} alt="" aria-hidden="true" />
  ) : (
    <div className="brand-mark" aria-hidden="true">
      <ScarabGlyph />
    </div>
  );
}

/** The Occupy scarab, holding a coin. Drawn in currentColor on a 64-unit grid. */
export function ScarabGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="32" cy="11" r="2.3" fill="currentColor" />
      <path d="M26 29a6 6 0 0 1 12 0z" fill="currentColor" />
      <rect x="19" y="30.5" width="26" height="9" rx="4.5" fill="currentColor" />
      <path d="M31 41.5h-8.5q-4.5 0-4.5 4.5v3q0 11.5 13 11.5z" fill="currentColor" />
      <path d="M33 41.5h8.5q4.5 0 4.5 4.5v3q0 11.5-13 11.5z" fill="currentColor" />
      <path
        d="M20 33l-6-5 8-11M44 33l6-5-8-11M18.5 47l-7-1-3 5M45.5 47l7-1 3 5M21 56l-6 2-1 4M43 56l6 2 1 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
