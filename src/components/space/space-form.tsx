/**
 * Create / edit a space: name, color and one of the three views (with a tiny
 * picture of each so the choice is visual). Deleting asks twice and says how many tasks go with it.
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { spaceActions, useSpaceTasks } from "@/lib/client/api";
import { closeSpaceForm, toast, toastError, useSpaceForm } from "@/lib/client/store";
import { SPACE_COLORS, SPACE_NAME_MAX, VIEWS, VIEW_META, spaceColorHex, type SpaceColor, type View } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/components/ui/cn";
import { ViewGlyph } from "./view-glyph";

export function SpaceForm() {
  const state = useSpaceForm();
  const key = state ? (state.mode === "edit" ? state.space.id : "new") : "closed";
  return state ? <SpaceFormInner key={key} /> : null;
}

function SpaceFormInner() {
  const state = useSpaceForm()!;
  const router = useRouter();
  const editing = state.mode === "edit" ? state.space : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState<SpaceColor>(editing?.color ?? "indigo");
  const [view, setView] = useState<View>(editing?.view ?? "kanban");
  const [saving, setSaving] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0);
  const { tasks } = useSpaceTasks(editing?.id ?? null);

  useEffect(() => {
    setTimeout(() => document.getElementById("space-name")?.focus(), 30);
  }, []);

  const save = async () => {
    if (!name.trim()) {
      toast("חסר שם למרחב", { tone: "error" });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await spaceActions.update(editing.id, { name: name.trim(), color, view });
        toast("המרחב עודכן", { tone: "success" });
        closeSpaceForm();
      } else {
        const space = await spaceActions.create({ name: name.trim(), color, view });
        closeSpaceForm();
        router.push(`/spaces/${space.id}`);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      const { deletedTasks } = await spaceActions.remove(editing.id);
      toast(deletedTasks ? `המרחב נמחק יחד עם ${deletedTasks} משימות` : "המרחב נמחק");
      closeSpaceForm();
      router.push("/");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal
      open
      size="md"
      onClose={closeSpaceForm}
      accent={spaceColorHex(color)}
      title={editing ? "הגדרות מרחב" : "מרחב חדש"}
      footer={
        <>
          <Button variant="primary" onClick={save} disabled={saving}>
            {editing ? "שמירת שינויים" : "יצירת המרחב"}
          </Button>
          <Button variant="ghost" onClick={closeSpaceForm}>
            ביטול
          </Button>
          {editing && deleteStep === 0 && (
            <Button variant="danger" size="sm" className="ms-auto" onClick={() => setDeleteStep(1)}>
              <Trash2 className="size-4" />
              מחיקת המרחב
            </Button>
          )}
        </>
      }
    >
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-muted">שם</span>
          <input
            id="space-name"
            dir="auto"
            value={name}
            maxLength={SPACE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="למשל: לקוחות, בית, לימודים"
            className="h-11 w-full rounded-[var(--radius-chip)] border border-line bg-surface px-3 text-[15px] outline-none focus:border-brass"
          />
        </label>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-muted">צבע</legend>
          <div className="flex flex-wrap gap-2">
            {SPACE_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setColor(c.key)}
                aria-label={c.label}
                aria-pressed={color === c.key}
                className="grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-105"
                style={{ background: c.hex, boxShadow: color === c.key ? `0 0 0 2px var(--surface), 0 0 0 4px ${c.hex}` : undefined }}
              >
                {color === c.key && <Check className="size-4 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-muted">תצוגה {editing && <span className="font-normal text-faint">(אפשר להחליף בכל רגע)</span>}</legend>
          <div className="grid grid-cols-3 gap-2">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-[var(--radius-card)] border-2 p-3 text-center transition-colors",
                  view === v ? "border-text bg-surface-2" : "border-line hover:border-line-strong",
                )}
              >
                <ViewGlyph view={v} color={spaceColorHex(color)} />
                <span className="text-sm font-semibold">{VIEW_META[v].label}</span>
                <span className="hidden text-xs leading-snug text-muted sm:block">{VIEW_META[v].hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {editing && deleteStep > 0 && (
          <div className="rounded-[var(--radius-card)] border border-danger/40 bg-[color-mix(in_srgb,var(--danger)_7%,transparent)] p-4">
            <p className="font-medium text-danger">
              {tasks.length
                ? `מחיקת המרחב תמחק גם ${tasks.length} משימות. אי אפשר לבטל את זה.`
                : "המרחב ריק. מחיקה לצמיתות?"}
            </p>
            <div className="mt-3 flex gap-2">
              {deleteStep === 1 ? (
                <Button variant="danger" size="sm" className="border border-danger" onClick={() => setDeleteStep(2)}>
                  הבנתי, להמשיך
                </Button>
              ) : (
                <Button size="sm" className="bg-danger text-white hover:brightness-110" onClick={remove}>
                  מחיקה סופית
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setDeleteStep(0)}>
                לא למחוק
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
