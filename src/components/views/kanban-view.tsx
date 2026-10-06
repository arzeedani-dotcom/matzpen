"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, StickyNote } from "lucide-react";
import { taskActions, type TaskChanges } from "@/lib/client/api";
import { openTaskEditor, toastError } from "@/lib/client/store";
import { PRIORITY_META, STATUSES, STATUS_META, type Space, type Status, type Task } from "@/lib/domain";
import { DueLabel, PriorityBadge } from "@/components/task/bits";
import { cn } from "@/components/ui/cn";
import { textDir } from "@/lib/text-dir";

/** The "done" column shows the most recent ones until "show all" is pressed. */
const DONE_VISIBLE = 20;

type Columns = Record<Status, string[]>;

const columnId = (status: Status) => `col:${status}`;
const statusOfColumnId = (id: UniqueIdentifier): Status | null => {
  const s = String(id);
  return s.startsWith("col:") ? (s.slice(4) as Status) : null;
};

/** Open columns keep the order set by dragging; "done" is newest-first. */
function buildColumns(tasks: Task[]): Columns {
  const cols: Columns = { new: [], in_progress: [], on_hold: [], done: [] };
  const open = tasks.filter((t) => t.status !== "done").sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  for (const t of open) cols[t.status].push(t.id);
  cols.done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .map((t) => t.id);
  return cols;
}

/** A position that sorts the task between its new neighbours. */
function positionAt(ids: string[], index: number, byId: ReadonlyMap<string, Task>): number {
  const prev = byId.get(ids[index - 1] ?? "");
  const next = byId.get(ids[index + 1] ?? "");
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return 1;
}

/**
 * Kanban: one column per status. Dragging between columns changes the status, dragging
 * inside a column changes the order. Works with a mouse, a finger (press and hold) and
 * the keyboard (Space lifts, arrows move, Space drops, Esc cancels).
 */
export function KanbanView({ space, tasks, today }: { space: Space; tasks: Task[]; today: string }) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const base = useMemo(() => buildColumns(tasks), [tasks]);
  /** The arrangement while a card is in the air (and until its save settles). */
  const [draft, setDraft] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const saving = useRef(0);

  const columns = draft ?? base;
  const active = activeId ? (byId.get(activeId) ?? null) : null;

  const sensors = useSensors(
    // Mouse and touch separately: a PointerSensor would also grab touches without the hold
    // delay, and the browser then cancels that pointer as soon as it starts to scroll.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter is left free to open the card.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const containerOf = (cols: Columns, id: UniqueIdentifier): Status | null =>
    statusOfColumnId(id) ?? STATUSES.find((s) => cols[s].includes(String(id))) ?? null;

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setDraft(base);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active: a, over } = e;
    if (!over) return;
    setDraft((prev) => {
      const cur = prev ?? base;
      const from = containerOf(cur, a.id);
      const to = containerOf(cur, over.id);
      if (!from || !to || from === to) return prev;
      const id = String(a.id);
      const target = [...cur[to]];
      const overIndex = target.indexOf(String(over.id));
      // Into "done" always lands on top — that is where it will sit once saved.
      const at = to === "done" ? 0 : overIndex < 0 ? target.length : overIndex;
      target.splice(at, 0, id);
      return { ...cur, [from]: cur[from].filter((x) => x !== id), [to]: target };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e;
    const id = String(a.id);
    const task = byId.get(id);
    let cur = draft ?? base;
    setActiveId(null);
    if (!task || !over) {
      setDraft(null);
      return;
    }
    const to = containerOf(cur, id);
    if (!to) {
      setDraft(null);
      return;
    }
    // Reorder inside the column it ended in.
    if (to !== "done") {
      const from = cur[to].indexOf(id);
      const target = cur[to].indexOf(String(over.id));
      if (target >= 0 && target !== from) cur = { ...cur, [to]: arrayMove(cur[to], from, target) };
    }

    const index = cur[to].indexOf(id);
    const patch: TaskChanges = {};
    if (to !== task.status) patch.status = to;
    if (to !== "done") {
      const moved = to !== task.status || base[to].indexOf(id) !== index;
      if (moved) patch.position = positionAt(cur[to], index, byId);
    }
    if (Object.keys(patch).length === 0) {
      setDraft(null);
      return;
    }

    // Keep the dropped arrangement on screen until the save settles; on failure the
    // cache is refetched and the card returns to where it was.
    setDraft(cur);
    saving.current += 1;
    taskActions
      .update(task, patch)
      .catch(toastError)
      .finally(() => {
        saving.current -= 1;
        if (saving.current === 0) setDraft(null);
      });
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `הרמת את המשימה ${byId.get(String(a.id))?.title ?? ""}.`,
    onDragOver: ({ over }) => {
      if (!over) return undefined;
      const status = containerOf(columns, over.id);
      return status ? `מעל העמודה ${STATUS_META[status].label}.` : undefined;
    },
    onDragEnd: ({ active: a, over }) => {
      const status = over ? containerOf(columns, a.id) : null;
      return status ? `המשימה הונחה בעמודה ${STATUS_META[status].label}.` : "הגרירה בוטלה.";
    },
    onDragCancel: () => "הגרירה בוטלה.",
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDraft(null);
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "להזזת משימה: רווח להרמה, חיצים להזזה, רווח להנחה, Escape לביטול. Enter פותח את המשימה.",
        },
      }}
    >
      <div className="scroll-quiet flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 sm:px-6 lg:snap-none">
        {STATUSES.map((status) => {
          const ids = columns[status];
          const limited = status === "done" && !showAllDone && ids.length > DONE_VISIBLE;
          const shown = limited ? ids.slice(0, DONE_VISIBLE) : ids;
          return (
            <Column
              key={status}
              status={status}
              count={ids.length}
              ids={shown}
              onAdd={() => openTaskEditor({ mode: "create", defaults: { spaceId: space.id, status } })}
              footer={
                status === "done" && ids.length > DONE_VISIBLE ? (
                  <button
                    type="button"
                    onClick={() => setShowAllDone((v) => !v)}
                    className="mt-1 h-10 w-full rounded-[var(--radius-chip)] text-sm font-medium text-muted hover:bg-surface hover:text-text"
                  >
                    {showAllDone ? `הצג רק ${DONE_VISIBLE} אחרונות` : `הצג הכול (${ids.length})`}
                  </button>
                ) : null
              }
            >
              {shown.map((id) => {
                const t = byId.get(id);
                return t ? <SortableCard key={id} task={t} today={today} /> : null;
              })}
            </Column>
          );
        })}
      </div>
      <DragOverlay>{active ? <Card task={active} today={today} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  count,
  ids,
  onAdd,
  footer,
  children,
}: {
  status: Status;
  count: number;
  ids: string[];
  onAdd: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) });
  const m = STATUS_META[status];
  return (
    <section
      aria-label={`${m.label}, ${count} משימות`}
      className="flex w-[84vw] max-w-[22rem] shrink-0 snap-center flex-col rounded-[var(--radius-panel)] bg-surface-2 sm:w-72 lg:w-auto lg:max-w-none lg:min-w-56 lg:flex-1"
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span aria-hidden className="text-muted">
          {m.mark}
        </span>
        <h2 className="text-sm font-semibold">{m.label}</h2>
        <span className="rounded-[var(--radius-chip)] border border-line bg-surface px-1.5 text-xs leading-5 font-medium text-muted tabular-nums">{count}</span>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`משימה חדשה בעמודה ${m.label}`}
          title="משימה חדשה"
          className="ms-auto grid size-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-text"
        >
          <Plus className="size-4" />
        </button>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "scroll-quiet flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-b-[var(--radius-panel)] px-2 pb-2 transition-colors",
            isOver && "bg-[color-mix(in_srgb,var(--brass)_9%,transparent)]",
          )}
        >
          {children}
          {count === 0 && <p className="px-2 py-6 text-center text-sm text-faint">אין כאן משימות</p>}
          {footer}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ task, today }: { task: Task; today: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${task.title}. עדיפות ${PRIORITY_META[task.priority].label}`}
      onClick={() => openTaskEditor({ mode: "edit", task })}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          openTaskEditor({ mode: "edit", task });
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      className={cn("touch-manipulation rounded-[var(--radius-card)]", isDragging && "opacity-35")}
    >
      <Card task={task} today={today} />
    </div>
  );
}

function Card({ task, today, lifted = false }: { task: Task; today: string; lifted?: boolean }) {
  const done = task.status === "done";
  return (
    <article
      className={cn(
        "cursor-grab rounded-[var(--radius-card)] border border-line bg-surface p-3 text-start select-none",
        lifted ? "cursor-grabbing shadow-[var(--shadow-pop)]" : "hover:border-line-strong",
      )}
      style={{ boxShadow: lifted ? undefined : `inset -3px 0 0 ${PRIORITY_META[task.priority].color}` }}
    >
      <p dir={textDir(task.title)} className={cn("leading-snug font-medium break-words", done && "text-muted line-through decoration-faint")}>
        {task.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <PriorityBadge priority={task.priority} compact />
        <DueLabel task={task} today={today} />
        {task.notes && (
          <span title="יש הערות" className="ms-auto text-faint">
            <StickyNote className="size-4" aria-hidden />
            <span className="sr-only">יש הערות</span>
          </span>
        )}
      </div>
    </article>
  );
}
