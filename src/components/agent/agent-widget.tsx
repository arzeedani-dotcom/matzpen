/**
 * The agent: a round launcher in the bottom-right corner and the chat window it opens.
 * The window floats (400px), can widen into a full-height side panel, and is a full
 * screen on phones. Everything the agent may touch is decided by the scope in its
 * header and enforced on the server; this file only renders the conversation.
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Maximize2, Minimize2, Sparkles, SquarePen, X } from "lucide-react";
import { MAX_HISTORY, type AgentScope, type PendingActionView } from "@/lib/agent/types";
import { agentApi } from "@/lib/client/agent";
import { refreshAll, useSpaces } from "@/lib/client/api";
import { setAgentOpen, setAgentScopeOverride, useAgentOpen, useAgentScope } from "@/lib/client/store";
import { spaceColorHex, type Space } from "@/lib/domain";
import { cn } from "@/components/ui/cn";

type PendingState = "open" | "confirmed" | "cancelled" | "closed";

interface Entry {
  id: number;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  pending?: PendingActionView;
  pendingState?: PendingState;
}

const STORAGE_KEY = "mz-agent-chat";
const KEEP = 60;

const SUGGESTIONS = [
  "מה הכי חשוב לי היום?",
  "מה באיחור?",
  "תסכם לי את השבוע",
  "תוסיף משימה: להתקשר לרואה החשבון מחר",
];

function loadEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as Entry[]) : [];
    if (!Array.isArray(list)) return [];
    // A card from an earlier visit may have expired on the server — never show it as live.
    return list.map((e) => (e.pendingState === "open" ? { ...e, pendingState: "closed" as const } : e));
  } catch {
    return [];
  }
}

function scopeLabel(scope: AgentScope, spaces: Space[]): string {
  if (scope.mode === "all") return "כל המרחבים";
  const chosen = spaces.filter((s) => scope.spaceIds.includes(s.id));
  if (chosen.length === 0) return "כל המרחבים";
  if (chosen.length === 1) return chosen[0].name;
  if (chosen.length === spaces.length) return "כל המרחבים";
  return `${chosen.length} מרחבים`;
}

export function AgentWidget() {
  const open = useAgentOpen();
  return (
    <>
      {!open && <Launcher />}
      {open && <Panel />}
    </>
  );
}

function Launcher() {
  return (
    <div className="group fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-50 flex items-center">
      <button
        type="button"
        onClick={() => setAgentOpen(true)}
        aria-label="שאל את הסוכן"
        className="grid size-14 place-items-center rounded-full bg-brass text-white shadow-[var(--shadow-pop)] transition-transform hover:scale-105 active:scale-95 dark:text-[#1b1306]"
      >
        <Sparkles className="size-6" aria-hidden />
      </button>
      <span
        aria-hidden
        className="pointer-events-none absolute right-full me-3 rounded-[var(--radius-chip)] bg-ink px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-text opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      >
        שאל את הסוכן
      </span>
    </div>
  );
}

function Panel() {
  const { spaces } = useSpaces();
  const { scope } = useAgentScope();
  // The conversation lives in this browser only. The panel mounts only after a click,
  // never during server rendering, so localStorage can be read up front.
  const [saved] = useState(() => {
    const list = loadEntries();
    return { list, lastId: list.reduce((m, e) => Math.max(m, e.id), 0) };
  });
  const [entries, setEntries] = useState<Entry[]>(saved.list);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const seq = useRef(saved.lastId);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-KEEP)));
    } catch {}
  }, [entries]);

  useEffect(() => {
    textarea.current?.focus();
    return () => abort.current?.abort();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  // Grow the input with its text, up to a few lines.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  const push = useCallback((e: Omit<Entry, "id">) => {
    const entry = { ...e, id: ++seq.current };
    setEntries((list) => [...list, entry]);
    return entry;
  }, []);

  /** Any new exchange makes an older confirmation card stale (the server does the same). */
  const closeCards = (state: PendingState, onlyId?: string) =>
    setEntries((list) =>
      list.map((e) =>
        e.pending && e.pendingState === "open" && (!onlyId || e.pending.id === onlyId) ? { ...e, pendingState: state } : e,
      ),
    );

  const finish = (event: Awaited<ReturnType<typeof agentApi.chat>>) => {
    if (event.type === "error") {
      push({ role: "assistant", content: event.message, error: true });
      return;
    }
    push({
      role: "assistant",
      content: event.reply,
      pending: event.pending,
      pendingState: event.pending ? "open" : undefined,
    });
    if (event.changed) void refreshAll();
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    setScopeOpen(false);
    const history = [...entries.filter((e) => !e.error), { role: "user" as const, content }]
      .slice(-MAX_HISTORY)
      .map((e) => ({ role: e.role, content: e.content }));
    closeCards("closed");
    push({ role: "user", content });
    setBusy("חושב…");
    abort.current = new AbortController();
    try {
      finish(await agentApi.chat({ messages: history, scope }, setBusy, abort.current.signal));
    } catch {
      // aborted (window closed or a new conversation started)
    } finally {
      setBusy(null);
      textarea.current?.focus();
    }
  };

  const decide = async (pending: PendingActionView, decision: "confirm" | "cancel") => {
    if (busy) return;
    closeCards(decision === "confirm" ? "confirmed" : "cancelled", pending.id);
    setBusy(decision === "confirm" ? "מבצע…" : "מבטל…");
    abort.current = new AbortController();
    try {
      finish(await agentApi.confirm({ pendingId: pending.id, decision, scope }, setBusy, abort.current.signal));
    } catch {
      // aborted
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    abort.current?.abort();
    setBusy(null);
    setEntries([]);
    setInput("");
    textarea.current?.focus();
  };

  return (
    <section
      role="dialog"
      aria-label="הסוכן"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (scopeOpen) setScopeOpen(false);
          else setAgentOpen(false);
        }
      }}
      className={cn(
        "animate-pop fixed z-50 flex flex-col overflow-hidden bg-surface text-text shadow-[var(--shadow-pop)]",
        // Phone: the whole screen.
        "inset-0 max-sm:pt-safe max-sm:pb-safe",
        wide
          ? "sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[440px] sm:border-s sm:border-line"
          : "sm:inset-auto sm:right-5 sm:bottom-5 sm:h-[min(640px,calc(100dvh-2.5rem))] sm:w-[400px] sm:rounded-[var(--radius-panel)] sm:border sm:border-line",
      )}
    >
      <header className="relative flex items-center gap-1 bg-ink py-2.5 ps-4 pe-2 text-ink-text">
        <Sparkles className="size-5 shrink-0 text-brass" aria-hidden />
        <div className="min-w-0 flex-1 ps-1.5">
          <div className="text-[15px] leading-tight font-semibold">הסוכן</div>
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={scopeOpen}
            onClick={() => setScopeOpen((v) => !v)}
            className="flex max-w-full items-center gap-1 rounded text-xs text-ink-muted hover:text-ink-text"
          >
            <span className="shrink-0">עובד על:</span>
            <span dir="auto" className="truncate font-semibold text-ink-text">
              {scopeLabel(scope, spaces)}
            </span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>
        <HeaderButton label="שיחה חדשה" onClick={reset}>
          <SquarePen className="size-[18px]" />
        </HeaderButton>
        <HeaderButton label={wide ? "חלון צף" : "הרחבה ללוח צד"} onClick={() => setWide((v) => !v)} className="max-sm:hidden">
          {wide ? <Minimize2 className="size-[18px]" /> : <Maximize2 className="size-[18px]" />}
        </HeaderButton>
        <HeaderButton label="סגירה" onClick={() => setAgentOpen(false)}>
          <X className="size-5" />
        </HeaderButton>
        {scopeOpen && <ScopePicker spaces={spaces} scope={scope} onClose={() => setScopeOpen(false)} />}
      </header>

      <div ref={scroller} className="scroll-quiet min-h-0 flex-1 space-y-3 overflow-y-auto bg-paper px-3 py-4" aria-live="polite">
        {entries.length === 0 && !busy && <Welcome onPick={(s) => void send(s)} />}
        {entries.map((e) => (
          <Message key={e.id} entry={e} busy={busy !== null} onDecide={decide} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 px-1 text-sm text-muted" role="status">
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-pulse rounded-full bg-brass" style={{ animationDelay: `${i * 160}ms` }} />
              ))}
            </span>
            {busy}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <label htmlFor="agent-input" className="sr-only">
          הודעה לסוכן
        </label>
        <textarea
          id="agent-input"
          ref={textarea}
          dir="auto"
          rows={1}
          value={input}
          maxLength={4000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="מה לעשות?"
          className="max-h-[132px] min-h-11 flex-1 resize-none rounded-[var(--radius-card)] border border-line-strong bg-surface px-3 py-2.5 leading-snug placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy !== null}
          aria-label="שליחה"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-ink-text transition-colors hover:bg-ink-2 disabled:opacity-40 dark:bg-brass dark:text-[#1b1306]"
        >
          <ArrowUp className="size-5" />
        </button>
      </form>
    </section>
  );
}

function HeaderButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn("grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-ink-2 hover:text-ink-text", className)}
    >
      {children}
    </button>
  );
}

/** One space, several, or all. A manual choice holds until the user moves to another page. */
function ScopePicker({ spaces, scope, onClose }: { spaces: Space[]; scope: AgentScope; onClose: () => void }) {
  const all = scope.mode === "all";
  const chosen = new Set(all ? spaces.map((s) => s.id) : scope.spaceIds);

  const toggle = (id: string) => {
    const next = new Set(all ? [] : chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0 || next.size === spaces.length) setAgentScopeOverride({ mode: "all" });
    else setAgentScopeOverride({ mode: "spaces", spaceIds: spaces.filter((s) => next.has(s.id)).map((s) => s.id) });
  };

  return (
    <>
      <button type="button" aria-label="סגירת הבחירה" className="fixed inset-0 z-10 cursor-default" onClick={onClose} />
      <div
        role="group"
        aria-label="על מה הסוכן עובד"
        className="animate-pop absolute inset-x-3 top-full z-20 mt-1 rounded-[var(--radius-card)] border border-line bg-surface p-1.5 text-text shadow-[var(--shadow-pop)]"
      >
        <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted">הסוכן רואה ומשנה רק משימות במרחבים שנבחרו.</p>
        <ScopeRow
          checked={all}
          onClick={() => {
            setAgentScopeOverride({ mode: "all" });
            onClose();
          }}
        >
          כל המרחבים
        </ScopeRow>
        <div className="my-1 h-px bg-line" />
        <div className="scroll-quiet max-h-64 overflow-y-auto">
          {spaces.map((s) => (
            <ScopeRow key={s.id} checked={!all && chosen.has(s.id)} onClick={() => toggle(s.id)}>
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: spaceColorHex(s.color) }} />
              <span dir="auto" className="truncate">
                {s.name}
              </span>
            </ScopeRow>
          ))}
        </div>
      </div>
    </>
  );
}

function ScopeRow({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex h-10 w-full items-center gap-2.5 rounded-[var(--radius-chip)] px-2.5 text-start text-sm hover:bg-surface-2"
    >
      <span className={cn("grid size-[18px] shrink-0 place-items-center rounded border", checked ? "border-ink bg-ink text-ink-text dark:border-brass dark:bg-brass dark:text-[#1b1306]" : "border-line-strong")}>
        {checked && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
      </span>
      {children}
    </button>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="px-1 pt-2">
      <p className="text-base font-semibold">במה לעזור?</p>
      <p className="mt-1 text-sm text-muted">
        אני קורא את המשימות ומבצע בהן פעולות: מוסיף, מעדכן, דוחה ומסכם. לפני מחיקה או שינוי של יותר מ־3 משימות אבקש אישור.
      </p>
      <div className="mt-4 flex flex-col items-start gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 text-start text-sm transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({
  entry,
  busy,
  onDecide,
}: {
  entry: Entry;
  busy: boolean;
  onDecide: (pending: PendingActionView, decision: "confirm" | "cancel") => void;
}) {
  const mine = entry.role === "user";
  return (
    <div className={cn("flex flex-col gap-2", mine ? "items-start" : "items-end")}>
      {entry.content && (
        <div
          dir="auto"
          className={cn(
            "max-w-[88%] rounded-[var(--radius-panel)] px-3.5 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap",
            mine && "rounded-ss-md bg-ink text-ink-text",
            !mine && !entry.error && "rounded-se-md border border-line bg-surface",
            entry.error && "rounded-se-md border border-danger/40 bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface))] text-danger",
          )}
          role={entry.error ? "alert" : undefined}
        >
          {entry.content}
        </div>
      )}
      {entry.pending && <ConfirmCard pending={entry.pending} state={entry.pendingState ?? "closed"} busy={busy} onDecide={onDecide} />}
    </div>
  );
}

const CLOSED_LABEL: Record<Exclude<PendingState, "open">, string> = {
  confirmed: "אושר",
  cancelled: "לא אושר — שום דבר לא השתנה",
  closed: "הבקשה כבר לא פעילה",
};

const KIND_VERB: Record<PendingActionView["kind"], string> = { add: "תוסיף", update: "תשנה", delete: "תמחק" };

function ConfirmCard({
  pending,
  state,
  busy,
  onDecide,
}: {
  pending: PendingActionView;
  state: PendingState;
  busy: boolean;
  onDecide: (pending: PendingActionView, decision: "confirm" | "cancel") => void;
}) {
  const live = state === "open";
  const rest = pending.count - pending.items.length;
  const count = pending.count === 1 ? "משימה אחת" : `${pending.count} משימות`;
  return (
    <div
      className={cn(
        "w-full max-w-[94%] rounded-[var(--radius-panel)] border bg-surface p-3.5",
        live ? "border-brass shadow-[0_0_0_3px_var(--brass-soft)]" : "border-line opacity-75",
      )}
    >
      <p className="font-semibold">
        הפעולה {KIND_VERB[pending.kind]} {count}
      </p>
      <p dir="auto" className="mt-0.5 text-sm text-muted">
        {pending.summary}
      </p>
      <ul className="scroll-quiet mt-2.5 max-h-44 space-y-1 overflow-y-auto text-sm">
        {pending.items.map((item, i) => (
          <li key={item.id ?? i} className="flex items-baseline gap-2">
            <span aria-hidden className="text-faint">
              •
            </span>
            <span dir="auto" className="min-w-0 flex-1 break-words">
              {item.title}
            </span>
            <span dir="auto" className="shrink-0 text-xs text-faint">
              {item.spaceName}
            </span>
          </li>
        ))}
        {rest > 0 && <li className="ps-4 text-xs text-muted">ועוד {rest}…</li>}
      </ul>
      {live ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(pending, "confirm")}
            className={cn(
              "h-10 flex-1 rounded-[var(--radius-chip)] font-semibold text-white disabled:opacity-50",
              pending.kind === "delete" ? "bg-danger dark:text-[#1b1306]" : "bg-ink text-ink-text dark:bg-brass dark:text-[#1b1306]",
            )}
          >
            מאשר
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(pending, "cancel")}
            className="h-10 flex-1 rounded-[var(--radius-chip)] border border-line-strong font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            לא מאשר
          </button>
        </div>
      ) : (
        <p className="mt-2.5 text-sm font-medium text-muted">{CLOSED_LABEL[state]}</p>
      )}
    </div>
  );
}
