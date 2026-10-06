"use client";

import { taskActions } from "@/lib/client/api";
import { toast, toastError } from "@/lib/client/store";
import { formatLongHebrew } from "@/lib/dates";
import type { Task } from "@/lib/domain";

/** Set (or clear) a task's due date — optimistic, with an undo in the toast. */
export async function moveTaskToDay(task: Task, day: string | null): Promise<void> {
  if (task.dueDate === day) return;
  const previous = task.dueDate;
  try {
    const saved = await taskActions.update(task, { dueDate: day });
    const message = day
      ? previous
        ? `הועבר ל${formatLongHebrew(day)}`
        : `נקבע ל${formatLongHebrew(day)}`
      : "התאריך הוסר — המשימה במגירת ״ללא תאריך״";
    toast(message, {
      tone: "success",
      action: {
        label: "ביטול",
        run: () => {
          taskActions.update(saved, { dueDate: previous }).catch(toastError);
        },
      },
    });
  } catch (e) {
    toastError(e);
  }
}

/** The check in day lists: done ⇄ new. */
export async function toggleTaskDone(task: Task): Promise<void> {
  const previous = task.status;
  const next = previous === "done" ? "new" : "done";
  try {
    const saved = await taskActions.update(task, { status: next });
    if (next === "done") {
      toast("המשימה הושלמה", {
        tone: "success",
        action: { label: "ביטול", run: () => void taskActions.update(saved, { status: previous }).catch(toastError) },
      });
    }
  } catch (e) {
    toastError(e);
  }
}
