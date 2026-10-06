/**
 * The small pieces every view shares, so priority, status and due dates look and
 * read identically in kanban, list, calendar, dashboard and the editor.
 */
"use client";

import { Check } from "lucide-react";
import { formatDue } from "@/lib/dates";
import {
  PRIORITIES,
  PRIORITY_META,
  STATUSES,
  STATUS_META,
  type Priority,
  type Status,
  type Task,
} from "@/lib/domain";
import { cn } from "@/components/ui/cn";
import { textDir } from "@/lib/text-dir";

/**
 * Priority-colored text. In dark mode the fixed hues are lifted toward white so small text
 * stays readable on the dark surfaces (the same lift the list's group headers use).
 */
const PRIORITY_TEXT = "text-[var(--pc)] dark:text-[color-mix(in_srgb,var(--pc)_72%,white)]";

export function PriorityBadge({ priority, compact = false }: { priority: Priority; compact?: boolean }) {
  const m = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-chip)] font-medium leading-none",
        PRIORITY_TEXT,
        compact ? "px-1.5 py-1 text-[11px]" : "px-2 py-1 text-xs",
      )}
      style={{ "--pc": m.color, background: `color-mix(in srgb, ${m.color} 13%, transparent)` } as React.CSSProperties}
      title={`עדיפות ${m.label}`}
    >
      <span aria-hidden>{m.mark}</span>
      {m.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius-chip)] border border-line px-2 py-0.5 text-xs text-muted">
      <span aria-hidden>{m.mark}</span>
      {m.label}
    </span>
  );
}

export function DueLabel({ task, today, className }: { task: Pick<Task, "dueDate" | "status">; today: string; className?: string }) {
  if (!task.dueDate) return null;
  const { text, tone } = formatDue(task.dueDate, today, task.status);
  return (
    <span
      className={cn(
        "inline-flex items-center text-xs whitespace-nowrap",
        tone === "overdue" && "font-semibold text-danger",
        tone === "today" && "font-semibold text-brass",
        tone === "tomorrow" && "font-medium text-text",
        tone === "normal" && "text-muted",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** Round check used in list, dashboard and calendar popovers. Checking = status "done". */
export function TaskCheck({
  done,
  onToggle,
  label,
  color,
}: {
  done: boolean;
  onToggle: () => void;
  label: string;
  /** Ring color — usually the priority color. */
  color?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `החזר לפתוחה: ${label}` : `סמן כהושלמה: ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
        done ? "border-success bg-success text-white" : "hover:bg-surface-2",
      )}
      style={done ? undefined : { borderColor: color ?? "var(--line-strong)" }}
    >
      {done && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

/** Segmented control for priority — colored, never a dropdown. */
export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div role="radiogroup" aria-label="עדיפות" className="grid grid-cols-4 gap-1.5">
      {PRIORITIES.map((p) => {
        const m = PRIORITY_META[p];
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p)}
            className={cn(
              "flex h-10 items-center justify-center gap-1 rounded-[var(--radius-chip)] border text-sm font-medium transition-colors",
              !active && PRIORITY_TEXT,
            )}
            style={
              active
                ? { background: m.color, borderColor: m.color, color: "#fff" }
                : ({ borderColor: "var(--line)", "--pc": m.color } as React.CSSProperties)
            }
          >
            <span aria-hidden>{m.mark}</span>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatusPicker({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div role="radiogroup" aria-label="סטטוס" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {STATUSES.map((s) => {
        const m = STATUS_META[s];
        const active = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s)}
            className={cn(
              "flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] border text-sm font-medium transition-colors",
              active ? "border-ink bg-ink text-ink-text dark:border-brass dark:bg-brass dark:text-[#1b1306]" : "border-line text-muted hover:text-text",
            )}
          >
            <span aria-hidden>{m.mark}</span>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Plain text with clickable links; keeps line breaks. */
export function Linkified({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <p dir={textDir(text)} className={cn("whitespace-pre-wrap break-words", className)}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="text-sky-700 underline underline-offset-2 dark:text-sky-400" dir="ltr">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}
