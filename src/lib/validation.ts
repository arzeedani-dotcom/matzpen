/** Input shapes shared by the REST API and the agent's tools. Nothing reaches the database without passing here. */
import { z } from "zod";
import { isValidISODate } from "./dates";
import {
  NOTES_MAX,
  PRIORITIES,
  SPACE_COLOR_KEYS,
  SPACE_NAME_MAX,
  STATUSES,
  TITLE_MAX,
  VIEWS,
} from "./domain";

export const isoDate = z.string().refine(isValidISODate, "תאריך לא תקין (YYYY-MM-DD)");

export const spaceCreateSchema = z.object({
  name: z.string().trim().min(1, "חסר שם למרחב").max(SPACE_NAME_MAX),
  color: z.enum(SPACE_COLOR_KEYS),
  view: z.enum(VIEWS),
});
export const spacePatchSchema = spaceCreateSchema.partial();

export const taskCreateSchema = z.object({
  spaceId: z.uuid(),
  title: z.string().trim().min(1, "חסרה כותרת").max(TITLE_MAX),
  notes: z.string().max(NOTES_MAX).nullish(),
  priority: z.enum(PRIORITIES).default("medium"),
  status: z.enum(STATUSES).default("new"),
  dueDate: isoDate.nullish(),
});

export const taskPatchSchema = z.object({
  spaceId: z.uuid().optional(),
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  notes: z.string().max(NOTES_MAX).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  dueDate: isoDate.nullable().optional(),
  position: z.number().finite().optional(),
});

export type SpaceCreate = z.infer<typeof spaceCreateSchema>;
export type SpacePatch = z.infer<typeof spacePatchSchema>;
export type TaskCreate = z.input<typeof taskCreateSchema>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;
