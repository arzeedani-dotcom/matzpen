"use client";

import { useEffect, useRef } from "react";
import { StickyNote } from "lucide-react";
import { instance } from "@/config/instance";
import { formatShortHebrew, todayIn } from "@/lib/dates";
import { PRIORITY_META, type Task } from "@/lib/domain";
import { openTaskEditor } from "@/lib/client/store";
import { DueLabel, StatusBadge, TaskCheck } from "@/components/task/bits";
import { cn } from "@/components/ui/cn";
import { prefersReducedMotion, token } from "./motion";
import { textDir } from "@/lib/text-dir";

/** How long the checked row lingers (check pops, title strikes) before it folds away. */
const LINGER_MS = 560;
const FOLD_MS = 280;

const rowBase = "relative flex items-start transition-colors first:rounded-t-[var(--radius-card)] last:rounded-b-[var(--radius-card)]";

/**
 * The check sits in a 48px-wide gutter that is itself tappable, so a thumb never has to
 * hit the 20px circle exactly. The rest of the row is one button that opens the editor.
 */
function CheckGutter({ onToggle, children }: { onToggle: () => void; children: React.ReactNode }) {
  return (
    <div
      // The real control is the checkbox inside; this only widens its touch area.
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex w-12 shrink-0 cursor-pointer justify-center self-stretch pt-[14px]"
    >
      {children}
    </div>
  );
}

function RowButton({ task, className, children }: { task: Task; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-list-row=""
      onClick={() => openTaskEditor({ mode: "edit", task })}
      className={cn(
        "flex min-h-12 min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1 rounded-[var(--radius-chip)] py-3 pe-4 text-start",
        "focus-visible:outline-offset-[-2px]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function OpenRow({
  task,
  today,
  leaving,
  flash,
  onToggle,
  onLeft,
}: {
  task: Task;
  today: string;
  /** Just checked: play the check, then fold the row away and call onLeft. */
  leaving: boolean;
  /** A changing non-zero number briefly highlights the row (just added / just restored). */
  flash: number;
  onToggle: (task: Task) => void;
  onLeft: (id: string) => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const checkRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const meta = PRIORITY_META[task.priority];
  const id = task.id;

  useEffect(() => {
    if (!leaving) return;
    const row = rowRef.current;
    if (!row) return;
    if (prefersReducedMotion()) {
      const t = setTimeout(() => onLeft(id), 350);
      return () => clearTimeout(t);
    }
    const pop = checkRef.current?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.3)", offset: 0.35 }, { transform: "scale(0.94)", offset: 0.7 }, { transform: "scale(1)" }],
      { duration: 420, easing: "cubic-bezier(.3,.7,.4,1)" },
    );
    const ring = ringRef.current?.animate(
      [
        { transform: "scale(1)", opacity: 0.55 },
        { transform: "scale(2.3)", opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
    let fold: Animation | undefined;
    const t = setTimeout(() => {
      row.style.overflow = "hidden"; // only while folding — the title is already fading out
      fold = row.animate(
        [
          { height: `${row.offsetHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        { duration: FOLD_MS, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
      );
      fold.onfinish = () => onLeft(id);
    }, LINGER_MS);
    return () => {
      clearTimeout(t);
      pop?.cancel();
      ring?.cancel();
      fold?.cancel();
      row.style.overflow = "";
    };
  }, [leaving, id, onLeft]);

  useEffect(() => {
    if (!flash) return;
    const row = rowRef.current;
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    if (prefersReducedMotion()) return;
    const a = row.animate([{ backgroundColor: token("--brass-soft") }, { backgroundColor: "transparent" }], {
      duration: 1400,
      easing: "ease-out",
    });
    return () => a.cancel();
  }, [flash]);

  const done = task.status === "done";
  const showStatus = task.status === "in_progress" || task.status === "on_hold";

  return (
    <li ref={rowRef} className={cn(rowBase, !leaving && "hover:bg-surface-2")}>
      <CheckGutter onToggle={() => onToggle(task)}>
        <span ref={checkRef} className="relative inline-grid">
          <span ref={ringRef} aria-hidden className="pointer-events-none absolute inset-0 rounded-full border-2 border-success opacity-0" />
          <TaskCheck done={done} onToggle={() => onToggle(task)} label={task.title} color={meta.color} />
        </span>
      </CheckGutter>
      <RowButton task={task}>
        <span
          dir={textDir(task.title)}
          className={cn(
            "min-w-0 flex-1 basis-44 break-words line-through decoration-transparent decoration-[1.5px] transition-[color,text-decoration-color] duration-300",
            done ? "text-muted decoration-faint" : "text-text",
          )}
        >
          {task.title}
        </span>
        <span className="ms-auto flex min-h-[23px] items-center gap-2.5">
          {task.notes && (
            <span title="יש הערות" className="text-faint">
              <StickyNote className="size-4" aria-hidden />
              <span className="sr-only">יש הערות</span>
            </span>
          )}
          {showStatus && <StatusBadge status={task.status} />}
          <DueLabel task={task} today={today} />
        </span>
      </RowButton>
    </li>
  );
}

function completedOn(iso: string): string {
  return formatShortHebrew(todayIn(instance.timeZone, new Date(iso)));
}

export function DoneRow({ task, onToggle }: { task: Task; onToggle: (task: Task) => void }) {
  return (
    <li className={cn(rowBase, "hover:bg-surface-2")}>
      <CheckGutter onToggle={() => onToggle(task)}>
        <TaskCheck done onToggle={() => onToggle(task)} label={task.title} />
      </CheckGutter>
      <RowButton task={task}>
        <span dir={textDir(task.title)} className="min-w-0 flex-1 basis-44 break-words text-muted line-through decoration-faint decoration-[1.5px]">
          {task.title}
        </span>
        {task.completedAt && (
          <span className="ms-auto flex min-h-[23px] items-center text-xs whitespace-nowrap text-faint">
            {completedOn(task.completedAt)}
          </span>
        )}
      </RowButton>
    </li>
  );
}
