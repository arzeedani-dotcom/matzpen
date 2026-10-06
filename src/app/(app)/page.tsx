"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { keys, useDashboard, useDashboardSelection, useSpaces, useToday } from "@/lib/client/api";
import { openSpaceForm, toastError, usePageAgentScope } from "@/lib/client/store";
import type { Space, SpaceStats } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { BurningList } from "@/components/dashboard/burning-list";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { SpaceCards } from "@/components/dashboard/space-cards";
import { SpaceFilter } from "@/components/dashboard/space-filter";
import { summarize } from "@/components/dashboard/summary";

/**
 * The dashboard: today's date, which spaces to look at (saved in the database, so the
 * choice follows the owner to every device), what is burning, and one card per space.
 */
export default function DashboardPage() {
  usePageAgentScope({ mode: "all" });
  const today = useToday();
  const { spaces, isLoading: spacesLoading } = useSpaces();
  const { spaceIds: saved, isLoading: selectionLoading, save } = useDashboardSelection();

  /** The saved selection, minus spaces that no longer exist. `null` = all spaces. */
  const selectedIds = useMemo(() => {
    if (saved === null) return null;
    const existing = new Set(spaces.map((s) => s.id));
    const ids = saved.filter((id) => existing.has(id));
    return ids.length === 0 || ids.length === spaces.length ? null : ids;
  }, [saved, spaces]);

  const allSelected = selectedIds === null;
  const selected = useMemo(() => new Set(selectedIds ?? spaces.map((s) => s.id)), [selectedIds, spaces]);
  const ready = !spacesLoading && !selectionLoading;
  const dashKey = keys.dashboard(selectedIds);
  const { data, error, isLoading } = useDashboard(selectedIds, ready && spaces.length > 0);

  const spacesById = useMemo(() => new Map<string, Space>(spaces.map((s) => [s.id, s])), [spaces]);
  const stats = useMemo(() => new Map<string, SpaceStats>((data?.stats ?? []).map((s) => [s.spaceId, s])), [data]);
  const shownSpaces = spaces.filter((s) => selected.has(s.id));

  const choose = (ids: string[] | null) => {
    save(ids).catch(toastError);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Nothing selected would be an empty page, and everything selected is simply "all".
    if (next.size === 0 || next.size === spaces.length) choose(null);
    else choose(spaces.filter((s) => next.has(s.id)).map((s) => s.id));
  };

  const summary = data
    ? summarize({ overdue: data.overdue.length, today: data.dueToday.length, urgent: data.urgent.length })
    : ready && spaces.length === 0
      ? "עוד אין כאן מרחבים."
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-28 sm:px-6 lg:pb-10">
      <DashboardHeader today={data?.today ?? today} summary={summary} />

      {ready && spaces.length === 0 ? (
        <FirstSpace />
      ) : (
        <>
          <div className="mt-6">
            {spacesLoading ? (
              <div className="h-9 w-72 animate-pulse rounded bg-line" aria-hidden />
            ) : (
              <SpaceFilter
                spaces={spaces}
                selected={selected}
                allSelected={allSelected}
                onToggle={toggle}
                onSelectAll={() => choose(null)}
              />
            )}
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-w-0">
              {error && !data ? (
                <p className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-danger">{error.message}</p>
              ) : data ? (
                <BurningList data={data} dashKey={dashKey} spacesById={spacesById} stale={isLoading} />
              ) : (
                <div className="space-y-3" aria-hidden>
                  <div className="h-6 w-28 animate-pulse rounded bg-line" />
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-[var(--radius-card)] bg-line/60" />
                  ))}
                </div>
              )}
            </div>
            <SpaceCards spaces={shownSpaces} stats={stats} />
          </div>
        </>
      )}
    </div>
  );
}

function FirstSpace() {
  return (
    <div className="mt-10 rounded-[var(--radius-panel)] border border-line bg-surface px-6 py-12 text-center">
      <p className="text-lg font-semibold">מתחילים ממרחב אחד.</p>
      <p className="mx-auto mt-1.5 max-w-md text-muted">
        מרחב הוא עולם של משימות: לקוחות, בית, לימודים. בוחרים לו שם, צבע ותצוגה, ואפשר לשנות הכול אחר כך.
      </p>
      <Button variant="primary" className="mt-5" onClick={() => openSpaceForm({ mode: "create" })}>
        <Plus className="size-4" />
        מרחב חדש
      </Button>
    </div>
  );
}
