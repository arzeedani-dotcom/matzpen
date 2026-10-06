"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-ink-text hover:bg-ink-2 dark:bg-brass dark:text-[#1b1306] dark:hover:brightness-110",
  secondary: "border border-line-strong bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
  /** The final, irreversible step. */
  "danger-solid": "bg-danger text-white hover:brightness-110",
};

export const Button = forwardRef<
  HTMLButtonElement,
  /** "icon" / "icon-sm": a square-ish icon-only button. (cn() does not merge classes, so a
   *  "px-0" passed in className would lose to the size's own padding and squash the icon.) */
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "icon" | "icon-sm" }
>(function Button({ variant = "secondary", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "md" && "h-10 px-4 text-[15px]",
        size === "sm" && "h-8 px-3 text-sm",
        size === "icon" && "size-10",
        size === "icon-sm" && "h-8 w-9",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
