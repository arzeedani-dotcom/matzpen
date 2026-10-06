"use client";

import { formatLongHebrew } from "@/lib/dates";

/**
 * The page's one bold moment: today's date as the headline, the year set quietly
 * beside it, and a human sentence about what needs attention underneath.
 * `summary === null` renders a placeholder line of the same height (no layout jump).
 */
export function DashboardHeader({ today, summary }: { today: string; summary: string | null }) {
  const long = formatLongHebrew(today); // "יום שלישי, 6 באוקטובר 2026"
  const cut = long.lastIndexOf(" ");
  const date = long.slice(0, cut);
  const year = long.slice(cut + 1);

  return (
    <header className="pt-2 sm:pt-4">
      <h1 className="text-[2rem] leading-[1.15] font-semibold tracking-[-0.01em] text-text sm:text-5xl sm:leading-[1.1] lg:text-[3.4rem]">
        <time dateTime={today}>
          {date}{" "}
          {/* A real space (not only margin), so the date reads "…באוקטובר 2026" to a screen reader and in copied text. */}
          <span className="ms-2 align-baseline text-[0.5em] font-normal tracking-normal text-faint">{year}</span>
        </time>
      </h1>
      <div className="mt-3 flex min-h-7 items-center gap-2.5 sm:mt-4">
        {/* The brass needle: this line is about now. */}
        <span aria-hidden className="h-[3px] w-6 shrink-0 rounded-full bg-brass" />
        {summary === null ? (
          <span className="h-4 w-56 animate-pulse rounded bg-line" aria-hidden />
        ) : (
          <p className="text-base text-muted sm:text-lg" aria-live="polite">
            {summary}
          </p>
        )}
      </div>
    </header>
  );
}
