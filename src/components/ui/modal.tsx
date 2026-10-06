/**
 * Accessible modal on the native <dialog>: focus trap, Esc and the top layer come
 * from the browser. Centered card on desktop, full-screen sheet on phones.
 */
"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  accent,
}: {
  open: boolean;
  /** Called on Esc, backdrop click or the close button. Return false from a guard to keep it open. */
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Optional color strip on the start edge (e.g. the space color). */
  accent?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-0 h-dvh max-h-none w-full max-w-none bg-surface p-0 text-text backdrop:bg-[rgb(7_31_35/0.45)] backdrop:backdrop-blur-[2px]",
        "sm:m-auto sm:h-auto sm:max-h-[min(90dvh,760px)] sm:rounded-[var(--radius-panel)] sm:shadow-[var(--shadow-pop)]",
        size === "sm" && "sm:max-w-md",
        size === "md" && "sm:max-w-xl",
        size === "lg" && "sm:max-w-3xl",
        open && "animate-pop",
      )}
    >
      {open && (
        <div className="pt-safe pb-safe flex h-full max-h-[inherit] flex-col sm:pt-0 sm:pb-0">
          <header
            className="flex items-center gap-3 border-b border-line px-5 py-4"
            style={accent ? { boxShadow: `inset -4px 0 0 ${accent}` } : undefined}
          >
            <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
              aria-label="סגירה"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex items-center gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
