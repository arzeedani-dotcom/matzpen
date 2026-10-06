"use client";

import { use } from "react";
import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import { spaceActions, useSpace, useSpaceTasks, useToday } from "@/lib/client/api";
import { openSpaceForm, openTaskEditor, toastError, usePageAgentScope } from "@/lib/client/store";
import { VIEWS, VIEW_META, spaceColorHex, type View } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { VIEW_ICONS } from "@/components/space/view-glyph";
import { KanbanView } from "@/components/views/kanban-view";
import { ListView } from "@/components/views/list-view";
import { CalendarView } from "@/components/views/calendar-view";

export default function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { space, isLoading } = useSpace(id);
  const { tasks, loaded, isLoading: tasksLoading, error } = useSpaceTasks(space ? id : null);
  const today = useToday();
  usePageAgentScope({ mode: "spaces", spaceIds: [id] });

  if (isLoading) return <div className="m-6 h-10 w-64 animate-pulse rounded-md bg-line" />;
  if (!space)
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <h1 className="text-xl font-semibold">המרחב לא נמצא</h1>
        <p className="mt-2 text-muted">ייתכן שהוא נמחק.</p>
        <Link href="/" className="mt-4 inline-block font-medium text-brass underline-offset-4 hover:underline">
          חזרה לדשבורד
        </Link>
      </div>
    );

  const color = spaceColorHex(space.color);
  const open = tasks.filter((t) => t.status !== "done").length;

  const switchView = async (view: View) => {
    if (view === space.view) return;
    try {
      await spaceActions.update(space.id, { view });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col lg:min-h-dvh">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold" dir="auto">
              {space.name}
            </h1>
            <p className="text-sm text-muted">{tasksLoading ? "טוען…" : open === 0 ? "אין משימות פתוחות" : `${open} משימות פתוחות`}</p>
          </div>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <div role="radiogroup" aria-label="תצוגה" className="flex rounded-[var(--radius-chip)] border border-line bg-surface-2 p-0.5">
            {VIEWS.map((v) => {
              const Icon = VIEW_ICONS[v];
              const active = v === space.view;
              return (
                <button
                  key={v}
                  role="radio"
                  aria-checked={active}
                  onClick={() => switchView(v)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-[5px] px-3 text-sm transition-colors",
                    active ? "bg-surface font-semibold text-text shadow-sm" : "text-muted hover:text-text",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{VIEW_META[v].label}</span>
                </button>
              );
            })}
          </div>
          <Button variant="ghost" size="icon" aria-label="הגדרות מרחב" title="הגדרות מרחב" onClick={() => openSpaceForm({ mode: "edit", space })}>
            <Settings2 className="size-5" />
          </Button>
          <Button variant="primary" onClick={() => openTaskEditor({ mode: "create", defaults: { spaceId: space.id } })}>
            <Plus className="size-4" />
            משימה חדשה
          </Button>
        </div>
      </header>

      <section className="min-h-0 flex-1">
        {error && !loaded ? (
          <p className="p-6 text-danger">{error.message}</p>
        ) : tasksLoading ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-[var(--radius-card)] bg-line/60" />
            ))}
          </div>
        ) : space.view === "kanban" ? (
          <KanbanView space={space} tasks={tasks} today={today} />
        ) : space.view === "list" ? (
          <ListView space={space} tasks={tasks} today={today} />
        ) : (
          <CalendarView space={space} tasks={tasks} today={today} />
        )}
      </section>
    </div>
  );
}
