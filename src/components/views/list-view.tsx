"use client";

import type { Space, Task } from "@/lib/domain";

/** Placeholder — replaced by the real List view. */
export function ListView({ space, tasks }: { space: Space; tasks: Task[]; today: string }) {
  return <div className="p-6 text-muted">List: {space.name} ({tasks.length})</div>;
}
