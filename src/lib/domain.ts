/**
 * The vocabulary of the app: priorities, statuses, views, space colors and the
 * JSON shapes that travel between server and browser. UI, API and agent all
 * import from here so a priority looks and reads the same everywhere.
 */

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ["new", "in_progress", "on_hold", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const VIEWS = ["kanban", "list", "calendar"] as const;
export type View = (typeof VIEWS)[number];

export const PRIORITY_META: Record<
  Priority,
  { label: string; color: string; soft: string; mark: string; rank: number }
> = {
  urgent: { label: "דחוף", color: "#DC2626", soft: "#FEE2E2", mark: "⚑", rank: 0 },
  high: { label: "גבוהה", color: "#EA580C", soft: "#FFEDD5", mark: "▲", rank: 1 },
  medium: { label: "בינונית", color: "#2563EB", soft: "#DBEAFE", mark: "●", rank: 2 },
  low: { label: "נמוכה", color: "#64748B", soft: "#E2E8F0", mark: "▽", rank: 3 },
};

export const STATUS_META: Record<Status, { label: string; mark: string }> = {
  new: { label: "חדשה", mark: "○" },
  in_progress: { label: "בעבודה", mark: "◐" },
  on_hold: { label: "בהשהייה", mark: "⏸" },
  done: { label: "הושלמה", mark: "✓" },
};

export const VIEW_META: Record<View, { label: string; hint: string }> = {
  kanban: { label: "קנבן", hint: "עמודות לפי סטטוס, עם גרירה" },
  list: { label: "רשימה", hint: "וי לכל משימה, לפי עדיפות" },
  calendar: { label: "לוח שנה", hint: "חודש שלם, לפי תאריך יעד" },
};

export const SPACE_COLORS = [
  { key: "indigo", label: "אינדיגו", hex: "#4F46E5" },
  { key: "amber", label: "ענבר", hex: "#D97706" },
  { key: "emerald", label: "אזמרגד", hex: "#059669" },
  { key: "rose", label: "ורד", hex: "#E11D48" },
  { key: "sky", label: "תכלת", hex: "#0284C7" },
  { key: "violet", label: "סגול", hex: "#7C3AED" },
  { key: "teal", label: "טורקיז", hex: "#0D9488" },
  { key: "orange", label: "כתום", hex: "#EA580C" },
  { key: "pink", label: "ורוד", hex: "#DB2777" },
  { key: "slate", label: "אפור", hex: "#475569" },
] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number]["key"];
export const SPACE_COLOR_KEYS = SPACE_COLORS.map((c) => c.key) as [SpaceColor, ...SpaceColor[]];

export function spaceColorHex(key: string): string {
  return SPACE_COLORS.find((c) => c.key === key)?.hex ?? "#475569";
}

/** A space as the API returns it. */
export interface Space {
  id: string;
  name: string;
  color: SpaceColor;
  view: View;
  position: number;
  createdAt: string;
}

/** A task as the API returns it. Dates are plain strings — `dueDate` is "YYYY-MM-DD". */
export interface Task {
  id: string;
  spaceId: string;
  title: string;
  notes: string | null;
  priority: Priority;
  status: Status;
  dueDate: string | null;
  position: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceStats {
  spaceId: string;
  open: number;
  overdue: number;
  closedThisWeek: number;
}

export interface DashboardData {
  today: string;
  overdue: Task[];
  dueToday: Task[];
  urgent: Task[];
  stats: SpaceStats[];
}

export const TITLE_MAX = 200;
export const NOTES_MAX = 5000;
export const SPACE_NAME_MAX = 40;

/** Sort for list views: priority, then due date (undated last), then position. */
export function compareByPriority(a: Task, b: Task): number {
  const p = PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
  if (p) return p;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.position - b.position;
}
