"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { dismissToast, useToasts, useTopDialog } from "@/lib/client/store";
import { cn } from "@/components/ui/cn";

/**
 * Toasts sit bottom-center, clear of the agent button in the bottom-right corner. While a
 * modal is open they render inside it — anything outside a modal <dialog> is covered and inert.
 */
export function Toaster() {
  const toasts = useToasts();
  const host = useTopDialog();
  const region = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[60] lg:bottom-5 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "animate-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-[var(--radius-card)] px-4 py-2.5 text-sm shadow-[var(--shadow-pop)]",
            t.tone === "error" ? "bg-danger text-white" : "bg-ink text-ink-text",
          )}
          role={t.tone === "error" ? "alert" : "status"}
        >
          {t.tone === "success" && <span className="text-brass" aria-hidden>✓</span>}
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
              className="font-semibold text-brass underline-offset-2 hover:underline"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} aria-label="סגירה" className="opacity-60 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
  return host ? createPortal(region, host) : region;
}
