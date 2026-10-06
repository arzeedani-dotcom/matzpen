"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { taskActions } from "@/lib/client/api";
import { toastError } from "@/lib/client/store";
import { PRIORITIES, PRIORITY_META, TITLE_MAX, type Priority, type Task } from "@/lib/domain";
import { cn } from "@/components/ui/cn";
import { textDir } from "@/lib/text-dir";

/**
 * The row at the top of the list: type, Enter, the task is in. Focus stays in the input
 * so a whole batch can be typed in one go. The priority sticks between entries.
 */
export function QuickAdd({
  spaceId,
  inputRef,
  onCreated,
}: {
  spaceId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onCreated: (task: Task) => void;
}) {
  const [value, setValue] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [pending, setPending] = useState(0);

  const submit = async () => {
    const title = value.trim();
    if (!title) return;
    setValue("");
    setPending((n) => n + 1);
    try {
      const task = await taskActions.create({ spaceId, title, priority, status: "new" });
      onCreated(task);
    } catch (e) {
      toastError(e);
      // Give the text back so nothing typed is lost — unless a new entry is already under way.
      setValue((v) => v || title);
    } finally {
      setPending((n) => n - 1);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-[var(--radius-card)] border border-line bg-surface ps-3 pe-1 shadow-sm transition-[border-color,box-shadow]",
        "has-[input:focus]:border-brass has-[input:focus]:shadow-[0_0_0_3px_var(--brass-soft)]",
      )}
    >
      {pending > 0 ? (
        <Loader2 className="size-5 shrink-0 animate-spin text-faint" aria-label="מוסיף…" />
      ) : (
        <Plus className="size-5 shrink-0 text-faint" aria-hidden />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            setValue("");
          }
        }}
        dir={textDir(value)}
        maxLength={TITLE_MAX}
        enterKeyHint="enter"
        autoComplete="off"
        placeholder="הוספת משימה מהירה…"
        aria-label="הוספת משימה מהירה"
        // 16px: iOS Safari zooms into any smaller input on focus.
        className="h-12 min-w-0 flex-1 bg-transparent px-1.5 text-base text-text outline-none placeholder:text-faint focus-visible:outline-none"
      />
      <PriorityMenu
        value={priority}
        onChange={(p) => {
          setPriority(p);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}

/** One compact trigger; the four priorities open beneath it as full-size, colored choices. */
function PriorityMenu({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const m = PRIORITY_META[value];

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    root?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`עדיפות למשימה החדשה: ${m.label}`}
        title="עדיפות למשימה החדשה"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] px-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
        style={{ color: m.color }}
      >
        <span aria-hidden className="text-base leading-none">
          {m.mark}
        </span>
        <span className="hidden sm:inline">{m.label}</span>
        <ChevronDown className="hidden size-3.5 opacity-70 sm:block" aria-hidden />
      </button>

      {open && (
        <div
          role="radiogroup"
          aria-label="עדיפות למשימה החדשה"
          onKeyDown={onMenuKey}
          className="animate-pop absolute end-0 top-full z-30 mt-1.5 w-44 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {PRIORITIES.map((p) => {
            const pm = PRIORITY_META[p];
            const active = p === value;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-11 w-full items-center gap-2.5 rounded-[var(--radius-chip)] px-3 text-start text-[15px] font-medium transition-colors",
                  !active && "hover:bg-surface-2",
                )}
                style={{
                  color: pm.color,
                  background: active ? `color-mix(in srgb, ${pm.color} 13%, transparent)` : undefined,
                }}
              >
                <span aria-hidden className="w-4 text-center">
                  {pm.mark}
                </span>
                {pm.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
