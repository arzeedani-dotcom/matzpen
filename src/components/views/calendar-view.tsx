"use client";

import type { Space, Task } from "@/lib/domain";

/** Placeholder — replaced by the real Calendar view. */
export function CalendarView({ space, tasks }: { space: Space; tasks: Task[]; today: string }) {
  return <div className="p-6 text-muted">Calendar: {space.name} ({tasks.length})</div>;
}
