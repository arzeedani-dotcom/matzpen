"use client";

import { Suspense, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { instance } from "@/config/instance";
import { HEBREW_MONTHS, HEBREW_WEEKDAYS, HEBREW_WEEKDAYS_SHORT, formatLongHebrew, monthGrid } from "@/lib/dates";
import { openTaskEditor } from "@/lib/client/store";
import { PRIORITY_META, type Space, type Task } from "@/lib/domain";
import { PriorityBadge, TaskCheck } from "@/components/task/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/modal";
import { moveTaskToDay, toggleTaskDone } from "./calendar/actions";
import { useFillHeight, useIsPhone, useMonthParam } from "./calendar/hooks";
import { TRAY_DROP_ID, countLabel, dayDropId, groupTasks, monthKeyOf, parseMonthKey, shiftMonth } from "./calendar/utils";

/** More than this many tasks on one day collapse into "+N נוספות". */
const MAX_PILLS = 3;
const MAX_DOTS = 4;

type Props = { space: Space; tasks: Task[]; today: string };

/** The month in the URL is read with useSearchParams, which needs a Suspense boundary. */
export function CalendarView(props: Props) {
  return (
    <Suspense fallback={<div className="m-6 h-96 animate-pulse rounded-[var(--radius-panel)] bg-line/60" />}>
      <Calendar {...props} />
    </Suspense>
  );
}

/**
 * A Google-Calendar-style month: Sunday-first grid, tasks as pills in their priority
 * color, drag a pill to another day to change its due date, and a "no date" tray to
 * drag from (or into, to clear a date). On phones days show dots and open a day sheet.
 */
function Calendar({ space, tasks, today }: Props) {
  const [month, setMonth] = useMonthParam(today);
  const isPhone = useIsPhone();
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const fill = useFillHeight(gridEl, !isPhone);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { year, month0 } = parseMonthKey(month)!;
  const days = useMemo(() => monthGrid(year, month0, instance.weekStartsOn), [year, month0]);
  const { byDay, undated } = useMemo(() => groupTasks(tasks), [tasks]);
  const active = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const weeks = days.length / 7;

  const sensors = useSensors(
    // Mouse and touch separately: a PointerSensor would also grab touches without the hold
    // delay, and the browser then cancels that pointer as soon as it starts to scroll.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const newTaskOn = (day: string | null) => openTaskEditor({ mode: "create", defaults: { spaceId: space.id, dueDate: day } });

  const onDayClick = (day: string) => {
    // Phone: a day with tasks opens its list; an empty day goes straight to a new task.
    if (isPhone && (byDay.get(day)?.length ?? 0) > 0) setOpenDay(day);
    else newTaskOn(day);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const task = tasks.find((t) => t.id === String(e.active.id));
    const over = e.over ? String(e.over.id) : null;
    if (!task || !over) return;
    if (over === TRAY_DROP_ID) void moveTaskToDay(task, null);
    else if (over.startsWith("day:")) void moveTaskToDay(task, over.slice(4));
  };

  // RTL: the future is to the left.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, dialog") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft" || e.key === "PageDown") setMonth(shiftMonth(month, 1));
    else if (e.key === "ArrowRight" || e.key === "PageUp") setMonth(shiftMonth(month, -1));
    else return;
    e.preventDefault();
    // The focused day may belong to the month that just left the screen; keep focus in the
    // calendar so the next arrow press still works.
    if (el.closest('[role="grid"]')) e.currentTarget.focus({ preventScroll: true });
  };

  const weekdayOrder = Array.from({ length: 7 }, (_, i) => (i + instance.weekStartsOn) % 7);
  const dayTasks = openDay ? (byDay.get(openDay) ?? []) : [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex flex-col lg:flex-row" onKeyDown={onKeyDown} tabIndex={-1} style={{ outline: "none" }}>
        <div className="min-w-0 flex-1 px-2 pt-3 sm:px-6 sm:pt-4">
          <div className="mb-3 flex items-center gap-2 px-2 sm:px-0">
            <h2 className="text-xl font-semibold" aria-live="polite">
              {HEBREW_MONTHS[month0]} <span className="font-normal text-muted tabular-nums">{year}</span>
            </h2>
            <div className="ms-auto flex items-center gap-1">
              <Button size="sm" onClick={() => setMonth(monthKeyOf(today))} disabled={month === monthKeyOf(today)}>
                היום
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="החודש הקודם" title="החודש הקודם (חץ ימינה)" onClick={() => setMonth(shiftMonth(month, -1))}>
                <ChevronRight className="size-5" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="החודש הבא" title="החודש הבא (חץ שמאלה)" onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronLeft className="size-5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-line text-center text-xs font-semibold text-muted">
            {weekdayOrder.map((d) => (
              <div key={d} className="py-1.5">
                <span className="hidden sm:inline">{HEBREW_WEEKDAYS[d]}</span>
                <span className="sm:hidden">{HEBREW_WEEKDAYS_SHORT[d]}</span>
              </div>
            ))}
          </div>

          <div
            ref={setGridEl}
            role="grid"
            aria-label={`${HEBREW_MONTHS[month0]} ${year}`}
            className="grid grid-cols-7 border-s border-line"
            style={{
              gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))`,
              height: fill ? Math.max(fill - 16, weeks * 104) : undefined,
            }}
          >
            {days.map((day) => (
              <DayCell
                key={day}
                day={day}
                inMonth={monthKeyOf(day) === month}
                isToday={day === today}
                tasks={byDay.get(day) ?? []}
                isPhone={isPhone}
                onClick={() => onDayClick(day)}
                onMore={() => setOpenDay(day)}
              />
            ))}
          </div>
        </div>

        <Tray tasks={undated} isPhone={isPhone} dragging={active !== null} onAdd={() => newTaskOn(null)} />
      </div>

      <DragOverlay dropAnimation={null}>{active ? <PillBody task={active} lifted /> : null}</DragOverlay>

      <Modal
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
        size="sm"
        title={openDay ? formatLongHebrew(openDay) : ""}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              const day = openDay;
              setOpenDay(null);
              newTaskOn(day);
            }}
          >
            <Plus className="size-4" />
            משימה חדשה ביום הזה
          </Button>
        }
      >
        {dayTasks.length === 0 ? (
          <p className="py-6 text-center text-muted">אין משימות ביום הזה.</p>
        ) : (
          <ul className="divide-y divide-line">
            {dayTasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-2.5">
                <span className="pt-0.5">
                  <TaskCheck done={t.status === "done"} onToggle={() => void toggleTaskDone(t)} label={t.title} color={PRIORITY_META[t.priority].color} />
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => {
                    setOpenDay(null);
                    openTaskEditor({ mode: "edit", task: t });
                  }}
                >
                  <span dir="auto" className={cn("block break-words font-medium", t.status === "done" && "text-muted line-through decoration-faint")}>
                    {t.title}
                  </span>
                </button>
                <PriorityBadge priority={t.priority} compact />
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </DndContext>
  );
}

function DayCell({
  day,
  inMonth,
  isToday,
  tasks,
  isPhone,
  onClick,
  onMore,
}: {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  tasks: Task[];
  isPhone: boolean;
  onClick: () => void;
  onMore: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(day) });
  const dayNumber = +day.slice(8);
  const shown = tasks.slice(0, MAX_PILLS);
  const more = tasks.length - shown.length;
  const label = `${formatLongHebrew(day)}${tasks.length ? `, ${countLabel(tasks.length)}` : ""}`;

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      onClick={onClick}
      className={cn(
        "flex min-h-16 min-w-0 cursor-pointer flex-col gap-0.5 border-e border-b border-line p-1 transition-colors sm:min-h-[104px]",
        inMonth ? "bg-surface hover:bg-surface-2" : "bg-paper",
        isOver && "bg-brass-soft hover:bg-brass-soft",
      )}
    >
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "mx-auto grid size-7 shrink-0 place-items-center rounded-full text-sm tabular-nums sm:mx-0",
          isToday ? "bg-brass font-bold text-white dark:text-[#1b1306]" : inMonth ? "text-text" : "text-faint",
        )}
        aria-current={isToday ? "date" : undefined}
      >
        {dayNumber}
      </button>

      {isPhone ? (
        tasks.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-[3px]" aria-hidden>
            {tasks.slice(0, MAX_DOTS).map((t) => (
              <span
                key={t.id}
                className={cn("size-1.5 rounded-full", t.status === "done" && "opacity-35")}
                style={{ background: PRIORITY_META[t.priority].color }}
              />
            ))}
            {tasks.length > MAX_DOTS && <span className="text-[9px] leading-none text-muted">+</span>}
          </div>
        )
      ) : (
        <>
          {shown.map((t) => (
            <Pill key={t.id} task={t} />
          ))}
          {more > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMore();
              }}
              className="rounded-[var(--radius-chip)] px-1.5 text-start text-xs leading-5 font-semibold text-muted hover:bg-line hover:text-text"
            >
              +{more} נוספות
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Pill({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`${task.title}. עדיפות ${PRIORITY_META[task.priority].label}`}
      onClick={(e) => {
        e.stopPropagation();
        openTaskEditor({ mode: "edit", task });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          openTaskEditor({ mode: "edit", task });
        }
      }}
      className={cn("min-w-0 touch-manipulation rounded-[var(--radius-chip)]", isDragging && "opacity-30")}
    >
      <PillBody task={task} />
    </div>
  );
}

function PillBody({ task, lifted = false }: { task: Task; lifted?: boolean }) {
  const m = PRIORITY_META[task.priority];
  const done = task.status === "done";
  return (
    <div
      className={cn(
        "flex cursor-grab items-center gap-1 rounded-[var(--radius-chip)] px-1.5 text-xs leading-[22px] font-medium select-none",
        lifted && "max-w-56 cursor-grabbing shadow-[var(--shadow-pop)]",
        done && "opacity-60",
      )}
      style={{
        background: lifted ? m.color : `color-mix(in srgb, ${m.color} 16%, var(--surface))`,
        color: lifted ? "#fff" : `color-mix(in srgb, ${m.color} 78%, var(--text))`,
      }}
      title={task.title}
    >
      <span aria-hidden className="shrink-0 text-[10px]">
        {done ? "✓" : m.mark}
      </span>
      <span dir="auto" className={cn("min-w-0 truncate", done && "line-through")}>
        {task.title}
      </span>
    </div>
  );
}

/** Open tasks without a due date. Drag one onto a day to schedule it; drop a pill here to clear its date. */
function Tray({
  tasks,
  isPhone,
  dragging,
  onAdd,
}: {
  tasks: Task[];
  isPhone: boolean;
  dragging: boolean;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY_DROP_ID });
  return (
    <aside
      ref={setNodeRef}
      aria-label="משימות ללא תאריך"
      className={cn(
        "mx-4 mt-5 mb-28 rounded-[var(--radius-panel)] border border-line bg-surface-2 p-3 transition-colors sm:mx-6 lg:my-4 lg:ms-0 lg:me-6 lg:w-60 lg:shrink-0 lg:self-start",
        dragging && "border-dashed border-line-strong",
        isOver && "border-brass bg-brass-soft",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">ללא תאריך</h2>
        <span className="rounded-[var(--radius-chip)] border border-line bg-surface px-1.5 text-xs leading-5 font-medium text-muted tabular-nums">{tasks.length}</span>
        <button type="button" onClick={onAdd} aria-label="משימה חדשה ללא תאריך" title="משימה חדשה" className="ms-auto grid size-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-text">
          <Plus className="size-4" />
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="py-3 text-center text-sm text-faint">{dragging ? "שחררו כאן כדי להסיר את התאריך" : "לכל המשימות הפתוחות יש תאריך."}</p>
      ) : (
        <ul className="scroll-quiet flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto">
          {tasks.map((t) => (
            <li key={t.id}>
              <Pill task={t} />
            </li>
          ))}
        </ul>
      )}
      {!isPhone && tasks.length > 0 && <p className="mt-2 text-xs text-faint">גררו משימה אל יום כדי לקבוע לה תאריך.</p>}
    </aside>
  );
}
