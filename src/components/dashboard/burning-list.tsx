"use client";

import { useState } from "react";
import { mutate } from "swr";
import { keys, optimistic, taskActions } from "@/lib/client/api";
import { openTaskEditor, toast, toastError } from "@/lib/client/store";
import { PRIORITY_META, spaceColorHex, type DashboardData, type Space, type Task } from "@/lib/domain";
import { DueLabel, PriorityBadge, TaskCheck } from "@/components/task/bits";
import { cn } from "@/components/ui/cn";
import { textDir } from "@/lib/text-dir";

type Group = "overdue" | "dueToday" | "urgent";

const GROUPS: { key: Group; label: string; tone: string; mark: React.ReactNode }[] = [
  { key: "overdue", label: "באיחור", tone: "text-danger", mark: <span className="size-2 rounded-full bg-danger" /> },
  { key: "dueToday", label: "להיום", tone: "text-brass", mark: <span className="size-2 rounded-full bg-brass" /> },
  { key: "urgent", label: "דחוף", tone: "text-text", mark: <span className="text-[11px] leading-none">⚑</span> },
];

const VISIBLE = 8;

// ── Optimistic edits of the dashboard cache ───────────────────────────────

function withoutTask(d: DashboardData, task: Task): DashboardData {
  const wasOverdue = d.overdue.some((t) => t.id === task.id);
  const strip = (list: Task[]) => list.filter((t) => t.id !== task.id);
  return {
    ...d,
    overdue: strip(d.overdue),
    dueToday: strip(d.dueToday),
    urgent: strip(d.urgent),
    stats: d.stats.map((s) =>
      s.spaceId === task.spaceId
        ? {
            ...s,
            open: Math.max(0, s.open - 1),
            overdue: wasOverdue ? Math.max(0, s.overdue - 1) : s.overdue,
            closedThisWeek: s.closedThisWeek + 1,
          }
        : s,
    ),
  };
}

function withTask(d: DashboardData, task: Task, group: Group, index: number): DashboardData {
  if (d[group].some((t) => t.id === task.id)) return d;
  const list = [...d[group]];
  list.splice(Math.min(index, list.length), 0, task);
  return {
    ...d,
    [group]: list,
    stats: d.stats.map((s) =>
      s.spaceId === task.spaceId
        ? {
            ...s,
            open: s.open + 1,
            overdue: group === "overdue" ? s.overdue + 1 : s.overdue,
            closedThisWeek: Math.max(0, s.closedThisWeek - 1),
          }
        : s,
    ),
  };
}

/** Complete a task from the dashboard: it leaves the list at once, with an undo in the toast. */
function useComplete(dashKey: string) {
  return async (task: Task, group: Group, index: number) => {
    const rollback = await optimistic<DashboardData>(dashKey, (d) => (d ? withoutTask(d, task) : d));
    try {
      const saved = await taskActions.update(task, { status: "done" });
      void mutate(keys.tasks(task.spaceId));
      toast("המשימה הושלמה", {
        tone: "success",
        action: {
          label: "ביטול",
          run: () => {
            void (async () => {
              await mutate<DashboardData>(dashKey, (d) => (d ? withTask(d, task, group, index) : d), {
                revalidate: false,
              });
              try {
                await taskActions.update(saved, { status: task.status });
                void mutate(keys.tasks(task.spaceId));
              } catch (e) {
                void mutate(dashKey);
                toastError(e);
              }
            })();
          },
        },
      });
    } catch (e) {
      await rollback();
      toastError(e);
    }
  };
}

// ── View ──────────────────────────────────────────────────────────────────

export function BurningList({
  data,
  dashKey,
  spacesById,
  stale,
}: {
  data: DashboardData;
  dashKey: string;
  spacesById: ReadonlyMap<string, Space>;
  /** The selection just changed and fresh data is on its way. */
  stale: boolean;
}) {
  const complete = useComplete(dashKey);
  const groups = GROUPS.filter((g) => data[g.key].length > 0);

  return (
    <section aria-labelledby="burning-title" className={cn("transition-opacity", stale && "opacity-60")}>
      <h2 id="burning-title" className="mb-3 text-lg font-semibold">
        מה בוער
      </h2>

      {groups.length === 0 ? (
        <CalmEmpty />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <TaskGroup
              key={g.key}
              group={g}
              tasks={data[g.key]}
              today={data.today}
              spacesById={spacesById}
              onComplete={(task, i) => void complete(task, g.key, i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskGroup({
  group,
  tasks,
  today,
  spacesById,
  onComplete,
}: {
  group: (typeof GROUPS)[number];
  tasks: Task[];
  today: string;
  spacesById: ReadonlyMap<string, Space>;
  onComplete: (task: Task, index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tasks : tasks.slice(0, VISIBLE);
  const hidden = tasks.length - shown.length;
  const headingId = `burning-${group.key}`;

  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface">
      <h3 id={headingId} className={cn("flex items-center gap-2 px-4 pt-3 pb-1 text-sm font-semibold", group.tone)}>
        <span aria-hidden className="grid size-3 place-items-center">
          {group.mark}
        </span>
        {group.label}
        <span className="font-normal text-faint tabular-nums">{tasks.length}</span>
      </h3>
      <ul aria-labelledby={headingId} className="divide-y divide-line">
        {shown.map((t, i) => (
          <TaskRow key={t.id} task={t} space={spacesById.get(t.spaceId)} today={today} onComplete={() => onComplete(t, i)} />
        ))}
      </ul>
      {(hidden > 0 || expanded) && tasks.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex h-11 w-full items-center justify-center rounded-b-[var(--radius-panel)] border-t border-line text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          {expanded ? "הצג פחות" : `הצג עוד ${hidden}`}
        </button>
      )}
    </div>
  );
}

function TaskRow({
  task,
  space,
  today,
  onComplete,
}: {
  task: Task;
  space: Space | undefined;
  today: string;
  onComplete: () => void;
}) {
  const open = () => openTaskEditor({ mode: "edit", task });
  return (
    <li
      onClick={open}
      className="flex min-h-14 cursor-pointer items-start gap-1 py-1.5 pe-4 ps-1.5 transition-colors last:rounded-b-[var(--radius-panel)] hover:bg-surface-2 active:bg-surface-2"
    >
      {/* A 44px hit area around the 20px check, so a thumb never opens the card by mistake. */}
      <div
        className="grid size-11 shrink-0 place-items-center"
        onClick={(e) => {
          e.stopPropagation();
          onComplete();
        }}
      >
        <TaskCheck done={false} onToggle={onComplete} label={task.title} color={PRIORITY_META[task.priority].color} />
      </div>
      <div className="min-w-0 flex-1 pt-2.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          className="block w-full text-start leading-snug font-medium break-words text-text"
        >
          <span dir={textDir(task.title)}>{task.title}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {space && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: spaceColorHex(space.color) }} />
              <span dir={textDir(space.name)}>{space.name}</span>
            </span>
          )}
          <DueLabel task={task} today={today} />
        </div>
      </div>
      <div className="shrink-0 pt-2.5">
        <PriorityBadge priority={task.priority} compact />
      </div>
    </li>
  );
}

function CalmEmpty() {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-6 py-10 text-center sm:py-12">
      <svg viewBox="0 0 48 48" aria-hidden className="mx-auto size-12 text-success">
        <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M15 24.5 L21.5 31 L33.5 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="mt-4 text-lg font-semibold text-text">אין שום דבר באיחור, להיום או דחוף.</p>
      <p className="mx-auto mt-1.5 max-w-sm text-muted">יום פנוי מכיבוי שריפות. זמן טוב לעבודה עמוקה על מה שבאמת חשוב.</p>
    </div>
  );
}
