"use client";

import type { Space, Task } from "@/lib/domain";

/** Placeholder — replaced by the real Kanban view. */
export function KanbanView({ space, tasks }: { space: Space; tasks: Task[]; today: string }) {
  return <div className="p-6 text-muted">Kanban: {space.name} ({tasks.length})</div>;
}
