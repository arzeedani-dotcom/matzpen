import { LayoutList, CalendarDays, Columns3 } from "lucide-react";
import type { View } from "@/lib/domain";

/** A miniature drawing of each view, used in the space form. */
export function ViewGlyph({ view, color }: { view: View; color: string }) {
  const bar = (w: string, o = 1) => <span className="block h-1.5 rounded-full" style={{ width: w, background: color, opacity: o }} />;
  return (
    <span className="flex h-14 w-full items-stretch justify-center gap-1 rounded-md bg-surface p-1.5 ring-1 ring-line" aria-hidden>
      {view === "kanban" &&
        [3, 2, 1, 2].map((n, i) => (
          <span key={i} className="flex flex-1 flex-col gap-1 rounded-sm bg-surface-2 p-0.5">
            {Array.from({ length: n }).map((_, j) => (
              <span key={j} className="block h-2 rounded-[2px]" style={{ background: color, opacity: 0.35 + j * 0.2 }} />
            ))}
          </span>
        ))}
      {view === "list" && (
        <span className="flex w-full flex-col justify-center gap-1.5 px-1">
          {bar("90%")}
          {bar("70%", 0.6)}
          {bar("80%", 0.4)}
        </span>
      )}
      {view === "calendar" && (
        <span className="grid w-full grid-cols-7 gap-0.5">
          {Array.from({ length: 21 }).map((_, i) => (
            <span key={i} className="rounded-[2px]" style={{ background: [3, 9, 10, 16].includes(i) ? color : "var(--surface-2)" }} />
          ))}
        </span>
      )}
    </span>
  );
}

export const VIEW_ICONS: Record<View, typeof LayoutList> = {
  kanban: Columns3,
  list: LayoutList,
  calendar: CalendarDays,
};
