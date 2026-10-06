/**
 * The frame around every signed-in page: the ink sidebar on the right (RTL start),
 * a top bar with a drawer on phones, and the globally mounted editors, toasts and agent.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, LayoutDashboard, LogOut, Menu, Moon, Plus, Sun, X } from "lucide-react";
import { instance } from "@/config/instance";
import { api, spaceActions, useSpaces } from "@/lib/client/api";
import { openSpaceForm, toastError } from "@/lib/client/store";
import { spaceColorHex } from "@/lib/domain";
import { cn } from "@/components/ui/cn";
import { TaskEditor } from "@/components/task/task-editor";
import { SpaceForm } from "@/components/space/space-form";
import { AgentWidget } from "@/components/agent/agent-widget";
import { CompassMark } from "./compass-mark";
import { Toaster } from "./toaster";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();

  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 bg-ink text-ink-text lg:block">
        <Sidebar />
      </aside>

      {/* Phone drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label="תפריט">
          <button className="absolute inset-0 bg-black/40" aria-label="סגירת התפריט" onClick={() => setDrawer(false)} />
          <aside className="animate-pop pt-safe pb-safe absolute inset-y-0 right-0 w-72 max-w-[85vw] bg-ink text-ink-text shadow-xl">
            <button
              onClick={() => setDrawer(false)}
              className="absolute top-3 left-3 grid size-9 place-items-center rounded-full text-ink-muted hover:bg-ink-2"
              aria-label="סגירה"
            >
              <X className="size-5" />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 bg-ink text-ink-text lg:hidden">
          <div className="flex h-14 items-center gap-3 px-4">
          <button onClick={() => setDrawer(true)} className="grid size-9 place-items-center rounded-full hover:bg-ink-2" aria-label="פתיחת התפריט">
            <Menu className="size-5" />
          </button>
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <CompassMark className="size-6" />
            {instance.productName}
          </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <TaskEditor />
      <SpaceForm />
      <Toaster />
      <AgentWidget />
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { spaces, isLoading } = useSpaces();
  /** "Arrange" mode: each space gets up/down arrows instead of being a link. */
  const [sorting, setSorting] = useState(false);

  const move = (index: number, delta: -1 | 1) => {
    const ids = spaces.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    spaceActions.reorder(ids).catch(toastError);
  };

  return (
    <nav className="flex h-full flex-col px-3 pt-5 pb-24" aria-label="ניווט ראשי">
      <div className="flex items-center gap-2.5 px-2">
        <CompassMark className="size-8" />
        <div className="min-w-0">
          <div className="text-lg leading-tight font-bold">{instance.productName}</div>
          <div className="truncate text-xs text-ink-muted">{instance.tagline}</div>
        </div>
      </div>

      <div className="mt-6">
        <NavLink href="/" active={pathname === "/"}>
          <LayoutDashboard className="size-[18px]" />
          דשבורד
        </NavLink>
      </div>

      <div className="mt-6 mb-1 flex items-center gap-1 px-2">
        <span className="flex-1 text-xs font-semibold text-ink-muted">מרחבים</span>
        {spaces.length > 1 && (
          <button
            onClick={() => setSorting((v) => !v)}
            className={cn(
              "grid size-7 place-items-center rounded-md hover:bg-ink-2 hover:text-ink-text",
              sorting ? "bg-ink-2 text-brass" : "text-ink-muted",
            )}
            aria-pressed={sorting}
            aria-label={sorting ? "סיום סידור המרחבים" : "שינוי סדר המרחבים"}
            title={sorting ? "סיום" : "שינוי סדר"}
          >
            {sorting ? <Check className="size-4" /> : <ArrowUpDown className="size-4" />}
          </button>
        )}
        <button
          onClick={() => openSpaceForm({ mode: "create" })}
          className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-ink-2 hover:text-ink-text"
          aria-label="מרחב חדש"
          title="מרחב חדש"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <ul className="scroll-quiet min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {isLoading &&
          [0, 1, 2].map((i) => <li key={i} className="mx-2 my-2 h-6 animate-pulse rounded bg-ink-2" />)}
        {spaces.map((s, i) => {
          const href = `/spaces/${s.id}`;
          if (sorting)
            return (
              <li key={s.id} className="flex h-10 items-center gap-2.5 rounded-md px-2 text-[15px] text-ink-text">
                <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: spaceColorHex(s.color) }} />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {s.name}
                </span>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`העלאת ${s.name}`}
                  className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-ink-2 hover:text-ink-text disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === spaces.length - 1}
                  aria-label={`הורדת ${s.name}`}
                  className="grid size-7 place-items-center rounded-md text-ink-muted hover:bg-ink-2 hover:text-ink-text disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
              </li>
            );
          return (
            <li key={s.id}>
              <NavLink href={href} active={pathname === href}>
                <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: spaceColorHex(s.color) }} />
                <span className="truncate" dir="auto">
                  {s.name}
                </span>
              </NavLink>
            </li>
          );
        })}
        {!isLoading && spaces.length === 0 && (
          <li>
            <button onClick={() => openSpaceForm({ mode: "create" })} className="w-full rounded-md px-2 py-2 text-start text-sm text-ink-muted hover:bg-ink-2">
              + יצירת המרחב הראשון
            </button>
          </li>
        )}
      </ul>

      <div className="mt-3 flex items-center gap-1 border-t border-white/10 px-1 pt-3">
        <ThemeToggle />
        <button
          onClick={async () => {
            await api("/api/auth/logout", { method: "POST" }).catch(() => {});
            window.location.href = "/login";
          }}
          className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-ink-2 hover:text-ink-text"
        >
          <LogOut className="size-4" />
          יציאה
        </button>
      </div>
    </nav>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-md px-2 text-[15px] transition-colors",
        active ? "bg-ink-2 font-semibold text-ink-text shadow-[inset_-3px_0_0_var(--brass)]" : "text-ink-muted hover:bg-ink-2/70 hover:text-ink-text",
      )}
    >
      {children}
    </Link>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  return (
    <button
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("mz-theme", next);
        } catch {}
        setDark(!dark);
      }}
      className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-ink-muted hover:bg-ink-2 hover:text-ink-text"
      aria-label={dark ? "מצב בהיר" : "מצב כהה"}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {dark ? "בהיר" : "כהה"}
    </button>
  );
}
