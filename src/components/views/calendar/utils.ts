/**
 * Pure helpers for the month calendar: month keys ("2026-10"), grouping tasks by
 * due date and the one sort order every day uses (open first, then priority).
 */
import { compareByPriority, type Task } from "@/lib/domain";

/** "YYYY-MM" — the shape of the `?m=` search param. */
export type MonthKey = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonthKey(value: string | null | undefined): { year: number; month0: number } | null {
  if (!value) return null;
  const m = MONTH_RE.exec(value);
  if (!m) return null;
  const year = +m[1];
  if (year < 1970 || year > 2200) return null;
  return { year, month0: +m[2] - 1 };
}

export function monthKeyOf(iso: string): MonthKey {
  return iso.slice(0, 7);
}

export function toMonthKey(year: number, month0: number): MonthKey {
  const d = new Date(Date.UTC(year, month0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const p = parseMonthKey(key)!;
  return toMonthKey(p.year, p.month0 + delta);
}

export function firstOfMonth(key: MonthKey): string {
  return `${key}-01`;
}

/** Open before done, then the shared priority order. */
export function compareDayTasks(a: Task, b: Task): number {
  const ad = a.status === "done" ? 1 : 0;
  const bd = b.status === "done" ? 1 : 0;
  if (ad !== bd) return ad - bd;
  return compareByPriority(a, b);
}

/** One pass over the tasks: dated ones bucketed by day (sorted), open undated ones for the tray. */
export function groupTasks(tasks: Task[]): { byDay: Map<string, Task[]>; undated: Task[] } {
  const byDay = new Map<string, Task[]>();
  const undated: Task[] = [];
  for (const t of tasks) {
    if (!t.dueDate) {
      if (t.status !== "done") undated.push(t);
      continue;
    }
    const list = byDay.get(t.dueDate);
    if (list) list.push(t);
    else byDay.set(t.dueDate, [t]);
  }
  for (const list of byDay.values()) list.sort(compareDayTasks);
  undated.sort(compareByPriority);
  return { byDay, undated };
}

/** "משימה אחת" / "3 משימות" */
export function countLabel(n: number): string {
  return n === 1 ? "משימה אחת" : `${n} משימות`;
}

export const dayDropId = (iso: string) => `day:${iso}`;
export const TRAY_DROP_ID = "tray";
