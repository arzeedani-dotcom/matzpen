/**
 * Calendar-day logic. Every date is a plain "YYYY-MM-DD" string and all
 * arithmetic runs in UTC, so daylight-saving shifts can never move a due date.
 * The only place a time zone enters is `todayIn`, which asks "what day is it there?".
 */
import type { Status } from "./domain";

export const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];
export const HEBREW_MONTHS_SHORT = [
  "ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני",
  "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳",
];
export const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const HEBREW_WEEKDAYS_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUTC(iso: string): Date {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The calendar date right now in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return toUTC(iso).getUTCDay();
}

export function weekStart(iso: string, weekStartsOn: 0 | 1 = 0): string {
  const offset = (dayOfWeek(iso) - weekStartsOn + 7) % 7;
  return addDays(iso, -offset);
}

export function isOverdue(task: { dueDate: string | null; status: Status }, today: string): boolean {
  return !!task.dueDate && task.status !== "done" && task.dueDate < today;
}

/** All dates of the month view: whole weeks from the week containing the 1st to the week containing the last day. */
export function monthGrid(year: number, month0: number, weekStartsOn: 0 | 1 = 0): string[] {
  const first = fromUTC(new Date(Date.UTC(year, month0, 1)));
  const last = fromUTC(new Date(Date.UTC(year, month0 + 1, 0)));
  const start = weekStart(first, weekStartsOn);
  const end = addDays(weekStart(last, weekStartsOn), 6);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export type DueTone = "overdue" | "today" | "tomorrow" | "normal";

export function formatShortHebrew(iso: string): string {
  const d = toUTC(iso);
  return `${HEBREW_WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ב${HEBREW_MONTHS_SHORT[d.getUTCMonth()]}`;
}

export function formatLongHebrew(iso: string): string {
  const d = toUTC(iso);
  return `יום ${HEBREW_WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ב${HEBREW_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** How a due date should read next to a task, relative to `today`. */
export function formatDue(iso: string, today: string, status?: Status): { text: string; tone: DueTone } {
  const diff = daysBetween(today, iso);
  if (diff < 0 && status !== "done") {
    const late = -diff;
    const text = late === 1 ? "באיחור של יום" : late === 2 ? "באיחור של יומיים" : `באיחור של ${late} ימים`;
    return { text, tone: "overdue" };
  }
  if (diff === 0) return { text: "היום", tone: "today" };
  if (diff === 1) return { text: "מחר", tone: "tomorrow" };
  return { text: formatShortHebrew(iso), tone: "normal" };
}
