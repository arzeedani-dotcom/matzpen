/**
 * Tiny global UI state (no library): the open task editor, the open space form and toasts.
 * Any component can call openTaskEditor(...) / toast(...) without prop drilling.
 */
"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AgentScope } from "@/lib/agent/types";
import type { Priority, Space, Status, Task } from "@/lib/domain";

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((prev: T) => T)) {
      state = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

type Store<T> = ReturnType<typeof createStore<T>>;

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// ── Task editor ──────────────────────────────────────────────────────────

export interface TaskDefaults {
  spaceId: string;
  dueDate?: string | null;
  status?: Status;
  priority?: Priority;
  title?: string;
}

export type TaskEditorState = { mode: "edit"; task: Task } | { mode: "create"; defaults: TaskDefaults } | null;

const taskEditor = createStore<TaskEditorState>(null);
export const openTaskEditor = (s: Exclude<TaskEditorState, null>) => taskEditor.set(s);
export const closeTaskEditor = () => taskEditor.set(null);
export const useTaskEditor = () => useStore(taskEditor);

// ── Space form ───────────────────────────────────────────────────────────

export type SpaceFormState = { mode: "create" } | { mode: "edit"; space: Space } | null;

const spaceForm = createStore<SpaceFormState>(null);
export const openSpaceForm = (s: Exclude<SpaceFormState, null>) => spaceForm.set(s);
export const closeSpaceForm = () => spaceForm.set(null);
export const useSpaceForm = () => useStore(spaceForm);

// ── Toasts ───────────────────────────────────────────────────────────────

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

const toasts = createStore<Toast[]>([]);
let seq = 0;

export function toast(message: string, opts: { tone?: Toast["tone"]; action?: Toast["action"]; ms?: number } = {}) {
  const id = ++seq;
  toasts.set((list) => [...list.slice(-2), { id, message, tone: opts.tone ?? "info", action: opts.action }]);
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.action ? 5000 : 3500));
  return id;
}
export const dismissToast = (id: number) => toasts.set((list) => list.filter((t) => t.id !== id));
export const useToasts = () => useStore(toasts);

/** Show an error from a failed action as a toast. */
export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : "הפעולה נכשלה", { tone: "error" });
}

// ── Agent panel ──────────────────────────────────────────────────────────

/** Whether the chat window is open — the launcher and panel share it. */
const agentOpen = createStore(false);
export const setAgentOpen = (open: boolean) => agentOpen.set(open);
export const useAgentOpen = () => useStore(agentOpen);

// ── Agent scope ──────────────────────────────────────────────────────────

/**
 * What the agent works on. Each page declares its default (a space page → that space,
 * the dashboard → all spaces); a manual choice in the chat header overrides it until
 * the user navigates to a page with a different default.
 */
const agentScope = createStore<{ pageDefault: AgentScope; override: AgentScope | null }>({
  pageDefault: { mode: "all" },
  override: null,
});

export function usePageAgentScope(scope: AgentScope) {
  const sig = JSON.stringify(scope);
  useEffect(() => {
    const cur = agentScope.get();
    if (JSON.stringify(cur.pageDefault) !== sig) agentScope.set({ pageDefault: JSON.parse(sig), override: null });
  }, [sig]);
}

export const setAgentScopeOverride = (scope: AgentScope | null) => agentScope.set((s) => ({ ...s, override: scope }));

export function useAgentScope(): { scope: AgentScope; isOverride: boolean } {
  const s = useStore(agentScope);
  return { scope: s.override ?? s.pageDefault, isOverride: s.override !== null };
}
