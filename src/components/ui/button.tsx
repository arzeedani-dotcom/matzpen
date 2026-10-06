"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-ink-text hover:bg-ink-2 dark:bg-brass dark:text-[#1b1306] dark:hover:brightness-110",
  secondary: "border border-line-strong bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }
>(function Button({ variant = "secondary", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "md" ? "h-10 px-4 text-[15px]" : "h-8 px-3 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
