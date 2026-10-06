/**
 * Smoke test for the screens: each view is rendered to HTML on the server with realistic
 * tasks, so a crash while rendering (a bad import, a wrong prop, a broken date) fails the
 * build instead of showing up as a blank page. Interaction is covered by the browser checks.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardData, Space, Task } from "@/lib/domain";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AgentWidget } from "@/components/agent/agent-widget";
import { BurningList } from "@/components/dashboard/burning-list";
import { SpaceCards } from "@/components/dashboard/space-cards";
import { SpaceFilter } from "@/components/dashboard/space-filter";
import { CalendarView } from "@/components/views/calendar-view";
import { KanbanView } from "@/components/views/kanban-view";
import { ListView } from "@/components/views/list-view";
import { setAgentOpen } from "@/lib/client/store";

const TODAY = "2026-10-06";
const space: Space = { id: "s1", name: "בית ואישי", color: "emerald", view: "list", position: 0, createdAt: "2026-10-01T08:00:00Z" };

let n = 0;
function task(patch: Partial<Task>): Task {
  n += 1;
  return {
    id: `t${n}`,
    spaceId: space.id,
    title: `משימה ${n}`,
    notes: null,
    priority: "medium",
    status: "new",
    dueDate: null,
    position: n,
    completedAt: null,
    createdAt: "2026-10-01T08:00:00Z",
    updatedAt: "2026-10-01T08:00:00Z",
    ...patch,
  };
}

const tasks: Task[] = [
  task({ title: "לשלם ארנונה", priority: "urgent", dueDate: "2026-10-04" }),
  task({ title: "להתקשר לסבתא", dueDate: TODAY, status: "in_progress" }),
  task({ title: "شراء حليب", priority: "low", dueDate: "2026-10-07", notes: "https://example.com" }),
  task({ title: "לקבוע תור", priority: "high", status: "on_hold" }),
  task({ title: "נסגרה אתמול", status: "done", dueDate: "2026-10-05", completedAt: "2026-10-05T10:00:00Z" }),
  // Five on one day → the calendar must fold the extra ones into "+N נוספות".
  ...[1, 2, 3, 4, 5].map((i) => task({ title: `עומס ${i}`, dueDate: "2026-10-15" })),
];

describe("screens render", () => {
  it("kanban: four columns with counters and the cards in them", () => {
    const html = renderToString(<KanbanView space={space} tasks={tasks} today={TODAY} />);
    for (const label of ["חדשה", "בעבודה", "בהשהייה", "הושלמה"]) expect(html).toContain(label);
    expect(html).toContain("לשלם ארנונה");
    expect(html).toContain("נסגרה אתמול");
  });

  it("list: grouped by priority, done tasks folded away", () => {
    const html = renderToString(<ListView space={space} tasks={tasks} today={TODAY} />);
    expect(html.indexOf("דחוף")).toBeLessThan(html.indexOf("נמוכה"));
    expect(html).toContain("شراء حليب");
    expect(html).toContain("הושלמו");
    expect(html).not.toContain("נסגרה אתמול"); // folded until opened
  });

  it("calendar: the month of today, pills on their day, overflow and the undated tray", () => {
    const html = renderToString(<CalendarView space={space} tasks={tasks} today={TODAY} />);
    expect(html).toContain("אוקטובר");
    expect(html).toContain("להתקשר לסבתא");
    expect(html).toContain("נוספות");
    expect(html).toContain("ללא תאריך");
    expect(html).toContain("לקבוע תור"); // undated → tray
  });

  it("dashboard: burning groups, the calm empty state, filter chips and space cards", () => {
    const data: DashboardData = {
      today: TODAY,
      overdue: [tasks[0]],
      dueToday: [tasks[1]],
      urgent: [],
      stats: [{ spaceId: space.id, open: 9, overdue: 1, closedThisWeek: 1 }],
    };
    const byId = new Map([[space.id, space]]);
    const html = renderToString(
      <>
        <SpaceFilter spaces={[space]} selected={new Set([space.id])} allSelected onToggle={() => {}} onSelectAll={() => {}} />
        <BurningList data={data} dashKey="/api/dashboard" spacesById={byId} stale={false} />
        <SpaceCards spaces={[space]} stats={new Map(data.stats.map((s) => [s.spaceId, s]))} />
      </>,
    );
    expect(html).toContain("מה בוער");
    expect(html).toContain("באיחור");
    expect(html).toContain("להיום");
    expect(html).toContain("נסגרה השבוע");

    const calm = renderToString(
      <BurningList data={{ ...data, overdue: [], dueToday: [] }} dashKey="/api/dashboard" spacesById={byId} stale={false} />,
    );
    expect(calm).toContain("אין שום דבר באיחור");
  });

  it("agent: a launcher when closed, the chat window with its scope when open", () => {
    setAgentOpen(false);
    expect(renderToString(<AgentWidget />)).toContain("שאל את הסוכן");
    setAgentOpen(true);
    const html = renderToString(<AgentWidget />);
    expect(html).toContain("עובד על:");
    expect(html).toContain("כל המרחבים");
    setAgentOpen(false);
  });
});
