/** Motion helpers for the list view. CSS media rules don't reach the Web Animations API, so we ask directly. */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Touch-first device (phone/tablet) — auto-focusing an input there would throw the keyboard up uninvited. */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

/** Read a design token (e.g. "--brass-soft") as a concrete color, for animations. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
