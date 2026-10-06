import type { Priority, SpaceColor, Status, View } from "@/lib/domain";

/** Seed tasks use day offsets from "today", so sample data always looks current. */
export interface SeedTask {
  title: string;
  priority: Priority;
  status: Status;
  /** Days from today (negative = overdue), or null for no due date. */
  due: number | null;
  notes?: string;
  /** For done tasks: how many days ago it was completed (default 0). */
  completedDaysAgo?: number;
}

export interface SeedSpace {
  name: string;
  color: SpaceColor;
  view: View;
  tasks: SeedTask[];
}
