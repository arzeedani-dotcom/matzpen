import { z } from "zod";
import { deleteTasks, getSpace, getTask, updateTasks } from "@/lib/repo";
import { HttpError, handle, ok, parseBody } from "@/lib/http";
import { taskPatchSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

async function taskId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "המשימה לא נמצאה");
  return id;
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const task = await getTask(await taskId(ctx));
  if (!task) throw new HttpError(404, "המשימה לא נמצאה");
  return ok(task);
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = await taskId(ctx);
  const patch = await parseBody(req, taskPatchSchema);
  if (patch.spaceId && !(await getSpace(patch.spaceId))) throw new HttpError(404, "המרחב לא נמצא");
  const [task] = await updateTasks([id], patch);
  if (!task) throw new HttpError(404, "המשימה לא נמצאה");
  return ok(task);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const n = await deleteTasks([await taskId(ctx)]);
  if (!n) throw new HttpError(404, "המשימה לא נמצאה");
  return ok({ deleted: n });
});
