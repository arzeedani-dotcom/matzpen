"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { openSpaceForm } from "@/lib/client/store";
import { spaceColorHex, type Space, type SpaceStats } from "@/lib/domain";
import { cn } from "@/components/ui/cn";

/**
 * One quiet card per selected space: its color on the start edge, its name, and three
 * counts read as a sentence ("4 פתוחות  1 באיחור  2 נסגרו השבוע"), then a dashed "new space" card.
 */
export function SpaceCards({
  spaces,
  stats,
  className,
}: {
  spaces: Space[];
  /** Missing entry = numbers still loading for that space. */
  stats: ReadonlyMap<string, SpaceStats>;
  className?: string;
}) {
  return (
    <section aria-labelledby="spaces-title" className={className}>
      <h2 id="spaces-title" className="mb-3 text-lg font-semibold">
        מרחבים
      </h2>
      <ul className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-1">
        {spaces.map((s) => (
          <li key={s.id}>
            <SpaceCard space={s} stats={stats.get(s.id)} />
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => openSpaceForm({ mode: "create" })}
            className="flex h-full min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 text-sm font-medium text-muted transition-colors hover:border-ink hover:text-text dark:hover:border-ink-muted"
          >
            <Plus className="size-4" aria-hidden />
            מרחב חדש
          </button>
        </li>
      </ul>
    </section>
  );
}

function SpaceCard({ space, stats }: { space: Space; stats: SpaceStats | undefined }) {
  return (
    <Link
      href={`/spaces/${space.id}`}
      className="relative block rounded-[var(--radius-card)] border border-line bg-surface py-3.5 ps-5 pe-4 transition-colors hover:border-line-strong hover:bg-surface-2 active:bg-surface-2"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-[5px] rounded-s-[var(--radius-card)]"
        style={{ background: spaceColorHex(space.color) }}
      />
      <div dir="auto" className="truncate py-0.5 font-semibold text-text">
        {space.name}
      </div>
      {stats ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <Stat n={stats.open} label={stats.open === 1 ? "פתוחה" : "פתוחות"} />
          <Stat n={stats.overdue} label="באיחור" tone={stats.overdue > 0 ? "danger" : "quiet"} />
          <Stat n={stats.closedThisWeek} label={stats.closedThisWeek === 1 ? "נסגרה השבוע" : "נסגרו השבוע"} tone="success" />
        </div>
      ) : (
        <div className="mt-2.5 mb-1 h-3.5 w-44 animate-pulse rounded bg-line" aria-hidden />
      )}
    </Link>
  );
}

function Stat({ n, label, tone = "plain" }: { n: number; label: string; tone?: "plain" | "danger" | "success" | "quiet" }) {
  return (
    <span className="flex items-baseline gap-1">
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "plain" && "text-text",
          tone === "danger" && "text-danger",
          tone === "success" && (n > 0 ? "text-success" : "text-faint"),
          tone === "quiet" && "text-faint",
        )}
      >
        {n}
      </span>
      <span className={cn(tone === "danger" ? "text-danger" : "text-muted")}>{label}</span>
    </span>
  );
}
