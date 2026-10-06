"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { taskActions } from "@/lib/client/api";
import { toast, toastError } from "@/lib/client/store";
import { PRIORITIES, PRIORITY_META, compareByPriority, type Priority, type Space, type Status, type Task } from "@/lib/domain";
import { cn } from "@/components/ui/cn";
import { QuickAdd } from "./list/quick-add";
import { DoneRow, OpenRow } from "./list/task-row";
import { isCoarsePointer } from "./list/motion";

const card = "divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface";

/**
 * The TODO list: quick-add on top, open tasks grouped by priority (urgent → low, each
 * group by due date, undated last), and a folded "done" drawer at the bottom.
 */
export function ListView({ space, tasks, today }: { space: Space; tasks: Task[]; today: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Checked a moment ago — still shown in their group while the check animation plays. */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  /** The status each task had before it was checked this session, so un-checking restores it. */
  const previous = useRef(new Map<string, Status>());

  const groups = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "done" || leaving.has(t.id)).sort(compareByPriority);
    return PRIORITIES.map((priority) => {
      const rows = open.filter((t) => t.priority === priority);
      return { priority, rows, count: rows.filter((t) => t.status !== "done").length };
    }).filter((g) => g.rows.length > 0);
  }, [tasks, leaving]);

  const done = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "done" && !leaving.has(t.id))
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    [tasks, leaving],
  );

  const isEmpty = groups.length === 0;

  const settle = useCallback((id: string) => {
    setLeaving((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  const highlight = (id: string) => setFlash((f) => ({ id, n: (f?.n ?? 0) + 1 }));

  const reopen = async (task: Task, status: Status) => {
    settle(task.id);
    previous.current.delete(task.id);
    try {
      const saved = await taskActions.update(task, { status });
      highlight(saved.id);
    } catch (e) {
      toastError(e);
    }
  };

  const complete = async (task: Task) => {
    const before = task.status;
    previous.current.set(task.id, before);
    setLeaving((s) => new Set(s).add(task.id));
    try {
      const saved = await taskActions.update(task, { status: "done" });
      toast("סומנה כהושלמה", {
        tone: "success",
        action: { label: "ביטול", run: () => void reopen(saved, before) },
      });
    } catch (e) {
      settle(task.id);
      previous.current.delete(task.id);
      toastError(e);
    }
  };

  const toggle = (task: Task) => {
    if (task.status === "done") void reopen(task, previous.current.get(task.id) ?? "new");
    else void complete(task);
  };

  // Nothing open: invite the next task by putting the cursor in quick-add. On touch devices
  // only on arrival — popping the keyboard right after the last check would be rude.
  const arrived = useRef(false);
  useEffect(() => {
    if (isEmpty && (!arrived.current || !isCoarsePointer())) inputRef.current?.focus({ preventScroll: true });
    arrived.current = true;
  }, [isEmpty]);

  // ↑/↓ walk between rows like a native list.
  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement;
    if (!target.hasAttribute("data-list-row")) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-list-row]"));
    const next = rows[rows.indexOf(target) + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const doneId = `done-${space.id}`;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6" onKeyDown={onListKey}>
      <QuickAdd spaceId={space.id} inputRef={inputRef} onCreated={(t) => highlight(t.id)} />

      {isEmpty ? (
        <EmptyState anyDone={done.length > 0} />
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            <section key={g.priority} aria-labelledby={`grp-${space.id}-${g.priority}`}>
              <GroupHeader id={`grp-${space.id}-${g.priority}`} priority={g.priority} count={g.count} />
              <ul className={card}>
                {g.rows.map((t) => (
                  <OpenRow
                    key={t.id}
                    task={t}
                    today={today}
                    leaving={leaving.has(t.id)}
                    flash={flash?.id === t.id ? flash.n : 0}
                    onToggle={toggle}
                    onLeft={settle}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            aria-expanded={showDone}
            aria-controls={doneId}
            onClick={() => setShowDone((v) => !v)}
            className="flex h-12 w-full items-center gap-2 rounded-[var(--radius-chip)] px-1 text-sm font-semibold text-muted transition-colors hover:text-text"
          >
            {/* Folded: the chevron points along the reading direction (left, in RTL). */}
            <ChevronDown className={cn("size-4 transition-transform duration-200", !showDone && "rotate-90")} aria-hidden />
            <span>
              הושלמו <span className="tabular-nums">({done.length})</span>
            </span>
            <span className="h-px flex-1 bg-line" aria-hidden />
          </button>
          {showDone && (
            <ul id={doneId} className={cn(card, "animate-pop mt-1")}>
              {done.map((t) => (
                <DoneRow key={t.id} task={t} onToggle={toggle} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function GroupHeader({ id, priority, count }: { id: string; priority: Priority; count: number }) {
  const m = PRIORITY_META[priority];
  return (
    <h2
      id={id}
      className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold"
      // In dark mode the fixed priority hues are lifted a little so they stay legible on the dark page.
      style={{ "--pc": m.color } as React.CSSProperties}
    >
      <span className="flex items-center gap-1.5 text-[var(--pc)] dark:text-[color-mix(in_srgb,var(--pc)_72%,white)]">
        <span aria-hidden>{m.mark}</span>
        {m.label}
      </span>
      <span className="rounded-[var(--radius-chip)] border border-line bg-surface px-1.5 text-xs leading-5 font-medium text-muted tabular-nums">
        {count}
        <span className="sr-only"> משימות</span>
      </span>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </h2>
  );
}

function EmptyState({ anyDone }: { anyDone: boolean }) {
  return (
    <div className="mt-10 flex flex-col items-center px-4 text-center">
      <span aria-hidden className="mb-3 grid size-11 place-items-center rounded-full border border-line bg-surface text-lg text-faint">
        {anyDone ? "✓" : "○"}
      </span>
      <p className="text-base font-semibold text-text">{anyDone ? "הכול סגור כאן." : "הרשימה עוד ריקה."}</p>
      <p className="mt-1 text-sm text-muted">
        {anyDone ? "מה הדבר הבא? כתבו אותו בשורה למעלה ולחצו Enter." : "מה הדבר הראשון שצריך לעשות? כתבו אותו למעלה ולחצו Enter."}
      </p>
    </div>
  );
}
