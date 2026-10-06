/**
 * The task card: one editor for creating and editing, opened from any view via
 * openTaskEditor(). Explicit save (button or Ctrl+Enter); asks before discarding edits.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { taskActions, useSpaces, useToday } from "@/lib/client/api";
import { closeTaskEditor, toast, toastError, useTaskEditor } from "@/lib/client/store";
import { addDays, formatLongHebrew } from "@/lib/dates";
import { NOTES_MAX, TITLE_MAX, spaceColorHex, type Priority, type Status } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/components/ui/cn";
import { Linkified, PriorityPicker, StatusPicker } from "./bits";
import { textDir } from "@/lib/text-dir";

interface Draft {
  title: string;
  notes: string;
  priority: Priority;
  status: Status;
  dueDate: string;
  spaceId: string;
}

export function TaskEditor() {
  const state = useTaskEditor();
  // Remount per opened task so the draft always starts fresh.
  const key = state ? (state.mode === "edit" ? state.task.id : `new-${state.defaults.spaceId}-${state.defaults.dueDate ?? ""}`) : "closed";
  return <TaskEditorInner key={key} />;
}

function TaskEditorInner() {
  const state = useTaskEditor();
  const { spaces } = useSpaces();
  const today = useToday();
  const titleRef = useRef<HTMLInputElement>(null);

  const initial: Draft | null = useMemo(() => {
    if (!state) return null;
    if (state.mode === "edit") {
      const t = state.task;
      return { title: t.title, notes: t.notes ?? "", priority: t.priority, status: t.status, dueDate: t.dueDate ?? "", spaceId: t.spaceId };
    }
    const d = state.defaults;
    return {
      title: d.title ?? "",
      notes: "",
      priority: d.priority ?? "medium",
      status: d.status ?? "new",
      dueDate: d.dueDate ?? "",
      spaceId: d.spaceId,
    };
  }, [state]);

  const [draft, setDraft] = useState<Draft | null>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingNotes, setEditingNotes] = useState(state?.mode === "create" || !initial?.notes);

  useEffect(() => {
    if (state) setTimeout(() => titleRef.current?.focus(), 30);
  }, [state]);

  if (!state || !draft || !initial) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const space = spaces.find((s) => s.id === draft.spaceId);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const close = () => {
    if (dirty && !window.confirm("יש שינויים שלא נשמרו. לסגור בלי לשמור?")) return;
    closeTaskEditor();
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      titleRef.current?.focus();
      toast("חסרה כותרת למשימה", { tone: "error" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title,
        notes: draft.notes.trim() || null,
        priority: draft.priority,
        status: draft.status,
        dueDate: draft.dueDate || null,
      };
      if (state.mode === "create") {
        await taskActions.create({ ...payload, spaceId: draft.spaceId });
        toast("המשימה נוספה", { tone: "success" });
      } else {
        await taskActions.update(state.task, {
          ...payload,
          ...(draft.spaceId !== state.task.spaceId ? { spaceId: draft.spaceId } : {}),
        });
        toast("השינויים נשמרו", { tone: "success" });
      }
      closeTaskEditor();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (state.mode !== "edit" || deleting) return;
    setDeleting(true);
    try {
      await taskActions.remove(state.task);
      toast("המשימה נמחקה");
      closeTaskEditor();
    } catch (e) {
      toastError(e);
      setDeleting(false);
    }
  };

  const quickDates = [
    { label: "היום", value: today },
    { label: "מחר", value: addDays(today, 1) },
    { label: "בעוד שבוע", value: addDays(today, 7) },
  ];

  return (
    <Modal
      open
      onClose={close}
      accent={space ? spaceColorHex(space.color) : undefined}
      title={state.mode === "create" ? "משימה חדשה" : "עריכת משימה"}
      footer={
        <>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "שומר…" : state.mode === "create" ? "הוספת משימה" : "שמירת שינויים"}
          </Button>
          <Button variant="ghost" onClick={close}>
            ביטול
          </Button>
          <span className="hidden text-xs text-faint sm:inline">Ctrl+Enter לשמירה</span>
          {state.mode === "edit" &&
            (confirmDelete ? (
              <span className="ms-auto flex items-center gap-2 text-sm">
                למחוק לצמיתות?
                <Button variant="danger" size="sm" onClick={remove} disabled={deleting}>
                  כן, למחוק
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  לא
                </Button>
              </span>
            ) : (
              <Button variant="danger" size="sm" className="ms-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" />
                מחיקה
              </Button>
            ))}
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <label className="block">
          <span className="sr-only">כותרת</span>
          <input
            ref={titleRef}
            dir={textDir(draft.title)}
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => set("title", e.target.value)}
            placeholder="מה צריך לעשות?"
            className="w-full border-0 border-b-2 border-line bg-transparent pb-2 text-xl font-semibold outline-none placeholder:text-faint focus:border-brass"
          />
        </label>

        <Field label="עדיפות">
          <PriorityPicker value={draft.priority} onChange={(v) => set("priority", v)} />
        </Field>

        <Field label="סטטוס">
          <StatusPicker value={draft.status} onChange={(v) => set("status", v)} />
        </Field>

        <Field label="תאריך יעד" hint={draft.dueDate ? formatLongHebrew(draft.dueDate) : "ללא תאריך"}>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className="h-10 rounded-[var(--radius-chip)] border border-line bg-surface px-3 text-sm"
            />
            {quickDates.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => set("dueDate", q.value)}
                className={cn(
                  "h-10 rounded-[var(--radius-chip)] border px-3 text-sm",
                  draft.dueDate === q.value ? "border-brass bg-brass-soft font-medium" : "border-line text-muted hover:text-text",
                )}
              >
                {q.label}
              </button>
            ))}
            {draft.dueDate && (
              <button type="button" onClick={() => set("dueDate", "")} className="h-10 px-2 text-sm text-muted hover:text-text">
                ניקוי
              </button>
            )}
          </div>
        </Field>

        <Field label="מרחב">
          <div className="flex flex-wrap gap-1.5">
            {spaces.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => set("spaceId", s.id)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full border px-3 text-sm",
                  s.id === draft.spaceId ? "border-text font-medium" : "border-line text-muted hover:text-text",
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: spaceColorHex(s.color) }} />
                {s.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="הערות">
          {editingNotes ? (
            <textarea
              dir={textDir(draft.notes)}
              value={draft.notes}
              maxLength={NOTES_MAX}
              onChange={(e) => set("notes", e.target.value)}
              rows={4}
              placeholder="פרטים, לינקים, מה סוכם…"
              className="w-full resize-y rounded-[var(--radius-card)] border border-line bg-surface-2 p-3 text-[15px] outline-none focus:border-brass"
            />
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if ((e.target as HTMLElement).tagName !== "A") setEditingNotes(true);
              }}
              onKeyDown={(e) => e.key === "Enter" && setEditingNotes(true)}
              className="cursor-text rounded-[var(--radius-card)] border border-line bg-surface-2 p-3 text-[15px] hover:border-line-strong"
              title="לחיצה לעריכה"
            >
              <Linkified text={draft.notes} />
            </div>
          )}
        </Field>
      </form>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
