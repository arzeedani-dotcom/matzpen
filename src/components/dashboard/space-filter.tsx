"use client";

import { Check } from "lucide-react";
import { spaceColorHex, type Space } from "@/lib/domain";
import { cn } from "@/components/ui/cn";
import { textDir } from "@/lib/text-dir";

/**
 * Which spaces the dashboard shows. One line that scrolls sideways on a phone
 * (edge to edge), wrapping on wider screens. Selected = filled dot + check;
 * never color alone.
 */
export function SpaceFilter({
  spaces,
  selected,
  allSelected,
  onToggle,
  onSelectAll,
}: {
  spaces: Space[];
  selected: ReadonlySet<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="המרחבים שמוצגים בדשבורד"
      className="scroll-quiet -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <Chip active={allSelected} pressed={allSelected} onClick={onSelectAll}>
        {allSelected && <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
        כל המרחבים
      </Chip>
      {spaces.map((s) => {
        const on = selected.has(s.id);
        const color = spaceColorHex(s.color);
        return (
          <Chip key={s.id} active={on && !allSelected} pressed={on} dim={!on} onClick={() => onToggle(s.id)}>
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full border-2"
              style={{ borderColor: color, background: on ? color : "transparent" }}
            />
            <span dir={textDir(s.name)} className="max-w-[12rem] truncate">
              {s.name}
            </span>
          </Chip>
        );
      })}
    </div>
  );
}

function Chip({
  active,
  pressed,
  dim = false,
  onClick,
  children,
}: {
  active: boolean;
  pressed: boolean;
  dim?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        // 44px tall on touch screens, a tighter 36px with a pointer.
        "inline-flex h-11 shrink-0 snap-start items-center gap-2 rounded-[var(--radius-chip)] border px-3.5 text-sm whitespace-nowrap transition-colors sm:h-9 sm:px-3",
        active && "border-line-strong bg-surface font-medium text-text",
        !active && !dim && "border-line bg-surface text-text",
        dim && "border-dashed border-line-strong text-faint hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}
