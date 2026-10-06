"use client";

import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { monthKeyOf, parseMonthKey, type MonthKey } from "./utils";

// ── Phone breakpoint ─────────────────────────────────────────────────────
// Same edge as Tailwind's `sm` (40rem), so JS and CSS never disagree.
const PHONE_QUERY = "(width < 40rem)";

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

// ── Shown month, kept in ?m=YYYY-MM ──────────────────────────────────────

/**
 * The month on screen lives in the URL so a refresh (or a shared link) keeps it.
 * Writes use the native History API, which Next's router syncs into useSearchParams
 * without a server round-trip — month flips stay instant.
 */
export function useMonthParam(today: string): [MonthKey, (next: MonthKey) => void] {
  const params = useSearchParams();
  const raw = params.get("m");
  const month = raw && parseMonthKey(raw) ? raw : monthKeyOf(today);

  const setMonth = useCallback((next: MonthKey) => {
    const sp = new URLSearchParams(window.location.search);
    sp.set("m", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}${window.location.hash}`);
  }, []);

  return [month, setMonth];
}

// ── Fill the viewport below the element's top edge ───────────────────────

/** Height that makes `el` reach the bottom of the viewport (desktop month grid). */
export function useFillHeight(el: HTMLElement | null, enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!el || !enabled) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(0, Math.floor(window.innerHeight - top)));
    };
    measure();
    window.addEventListener("resize", measure);
    // The page header can wrap when the sidebar or fonts change its width.
    const ro = new ResizeObserver(measure);
    if (el.parentElement?.parentElement) ro.observe(el.parentElement.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [el, enabled]);

  return enabled ? height : null;
}

/** Live height of an element (used to decide how many pills fit a day row). */
export function useElementHeight(el: HTMLElement | null): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return h;
}
