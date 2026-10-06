/**
 * Browser-side data access: one fetch helper, SWR keys, and hooks with optimistic
 * updates. Views never call fetch directly — they use these hooks so that every
 * change (by hand or by the agent) refreshes the same caches.
 */
"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { instance } from "@/config/instance";
import { todayIn } from "@/lib/dates";
import type { DashboardData, Priority, Space, SpaceColor, Status, Task, View } from "@/lib/domain";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "אין חיבור לשרת. בדוק את החיבור לאינטרנט.");
  }
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    // A full reload, not router.push: it drops every cached query of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? "הפעולה נכשלה");
  return data as T;
}

function fetcher<T>(url: string): Promise<T> {
  return api<T>(url);
}

export const keys = {
  spaces: "/api/spaces",
  tasks: (spaceId: string) => `/api/tasks?spaceId=${spaceId}`,
  /** null = all spaces */
  dashboard: (spaceIds: string[] | null) =>
    spaceIds === null ? "/api/dashboard" : `/api/dashboard?spaceIds=${spaceIds.join(",")}`,
  dashboardSelection: "/api/settings/dashboard",
};

/** Refetch everything on screen — used after the agent changed data. */
export function refreshAll() {
  return globalMutate((key) => typeof key === "string" && key.startsWith("/api/"));
}

function refreshDashboards() {
  return globalMutate((key) => typeof key === "string" && key.startsWith("/api/dashboard"));
}

/** Today's date in the owner's time zone ("YYYY-MM-DD"). */
export function useToday(): string {
  return todayIn(instance.timeZone);
}

// ── Spaces ────────────────────────────────────────────────────────────────

export function useSpaces() {
  const { data, error, isLoading } = useSWR<Space[]>(keys.spaces, fetcher);
  return { spaces: data ?? [], error: error as ApiError | undefined, isLoading };
}

export function useSpace(id: string) {
  const { spaces, isLoading, error } = useSpaces();
  return { space: spaces.find((s) => s.id === id) ?? null, isLoading, error };
}

export interface SpaceInput {
  name: string;
  color: SpaceColor;
  view: View;
}

export const spaceActions = {
  async create(input: SpaceInput): Promise<Space> {
    const space = await api<Space>(keys.spaces, { method: "POST", json: input });
    await globalMutate(keys.spaces);
    return space;
  },
  async update(id: string, patch: Partial<SpaceInput>): Promise<Space> {
    await globalMutate<Space[]>(
      keys.spaces,
      (list) => list?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      { revalidate: false },
    );
    try {
      return await api<Space>(`/api/spaces/${id}`, { method: "PATCH", json: patch });
    } finally {
      await globalMutate(keys.spaces);
    }
  },
  async remove(id: string): Promise<{ deletedTasks: number }> {
    const result = await api<{ deletedTasks: number }>(`/api/spaces/${id}`, { method: "DELETE" });
    await refreshAll();
    return result;
  },
  async reorder(ids: string[]): Promise<void> {
    await globalMutate<Space[]>(
      keys.spaces,
      (list) => {
        if (!list) return list;
        const byId = new Map(list.map((s) => [s.id, s]));
        return ids.flatMap((id, i) => {
          const s = byId.get(id);
          return s ? [{ ...s, position: i }] : [];
        });
      },
      { revalidate: false },
    );
    await api(`/api/spaces/reorder`, { method: "POST", json: { ids } });
    await globalMutate(keys.spaces);
  },
};

// ── Tasks ─────────────────────────────────────────────────────────────────

export function useSpaceTasks(spaceId: string | null) {
  const { data, error, isLoading } = useSWR<Task[]>(spaceId ? keys.tasks(spaceId) : null, fetcher);
  return { tasks: data ?? [], error: error as ApiError | undefined, isLoading };
}

export interface TaskInput {
  spaceId: string;
  title: string;
  notes?: string | null;
  priority?: Priority;
  status?: Status;
  dueDate?: string | null;
}

export type TaskChanges = Partial<Omit<TaskInput, "spaceId">> & { spaceId?: string; position?: number };

/** Apply a patch locally the way the server will (including completedAt). */
function applyPatch(task: Task, patch: TaskChanges): Task {
  const next = { ...task, ...patch, updatedAt: new Date().toISOString() } as Task;
  if (patch.status !== undefined) {
    next.completedAt =
      patch.status === "done" ? (task.status === "done" ? task.completedAt : new Date().toISOString()) : null;
  }
  return next;
}

export const taskActions = {
  async create(input: TaskInput): Promise<Task> {
    const task = await api<Task>("/api/tasks", { method: "POST", json: input });
    await globalMutate<Task[]>(keys.tasks(input.spaceId), (list) => (list ? [...list, task] : list), {
      revalidate: false,
    });
    void refreshDashboards();
    return task;
  },

  /**
   * Optimistic: the screen changes immediately; on failure it rolls back and the error
   * is thrown so the caller can show a toast.
   */
  async update(task: Task, patch: TaskChanges): Promise<Task> {
    const optimistic = applyPatch(task, patch);
    const from = keys.tasks(task.spaceId);
    const movedTo = patch.spaceId && patch.spaceId !== task.spaceId ? keys.tasks(patch.spaceId) : null;
    await globalMutate<Task[]>(
      from,
      (list) =>
        movedTo ? list?.filter((t) => t.id !== task.id) : list?.map((t) => (t.id === task.id ? optimistic : t)),
      { revalidate: false },
    );
    try {
      const saved = await api<Task>(`/api/tasks/${task.id}`, { method: "PATCH", json: patch });
      if (!movedTo) {
        await globalMutate<Task[]>(from, (list) => list?.map((t) => (t.id === saved.id ? saved : t)), {
          revalidate: false,
        });
      } else {
        await globalMutate(movedTo);
      }
      void refreshDashboards();
      return saved;
    } catch (e) {
      await globalMutate(from);
      throw e;
    }
  },

  async remove(task: Task): Promise<void> {
    const key = keys.tasks(task.spaceId);
    await globalMutate<Task[]>(key, (list) => list?.filter((t) => t.id !== task.id), { revalidate: false });
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      void refreshDashboards();
    } catch (e) {
      await globalMutate(key);
      throw e;
    }
  },
};

// ── Dashboard ─────────────────────────────────────────────────────────────

/** The saved dashboard selection. `null` = all spaces. */
export function useDashboardSelection() {
  const { data, isLoading } = useSWR<{ spaceIds: string[] | null }>(keys.dashboardSelection, fetcher);
  const save = async (spaceIds: string[] | null) => {
    await globalMutate(keys.dashboardSelection, { spaceIds }, { revalidate: false });
    await api(keys.dashboardSelection, { method: "PUT", json: { spaceIds } });
  };
  return { spaceIds: data?.spaceIds ?? null, isLoading, save };
}

export function useDashboard(spaceIds: string[] | null, enabled = true) {
  const { data, error, isLoading } = useSWR<DashboardData>(enabled ? keys.dashboard(spaceIds) : null, fetcher, {
    keepPreviousData: true,
  });
  return { data, error: error as ApiError | undefined, isLoading };
}
