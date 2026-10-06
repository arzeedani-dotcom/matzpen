/** The brand mark: a compass rose reduced to a ring and one needle — brass points to "now". */
export function CompassMark({ className, spin = false }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <g className={spin ? "origin-center animate-[spin_1.2s_ease-in-out_1]" : undefined} style={{ transformOrigin: "16px 16px" }}>
        <path d="M16 4.5 L19.2 16 L16 14.6 L12.8 16 Z" fill="var(--brass)" />
        <path d="M16 27.5 L12.8 16 L16 17.4 L19.2 16 Z" fill="currentColor" fillOpacity="0.55" />
      </g>
      <circle cx="16" cy="16" r="1.6" fill="currentColor" />
    </svg>
  );
}
