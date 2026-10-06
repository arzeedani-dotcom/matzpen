import { z } from "zod";
import { createTasks, getSpace, listTasks } from "@/lib/repo";
import { HttpError, handle, ok, parseBody } from "@/lib/http";
import { taskCreateSchema } from "@/lib/validation";

/** GET /api/tasks?spaceId=… — all tasks of one space (every status). */
export const GET = handle(async (req: Request) => {
  const spaceId = new URL(req.url).searchParams.get("spaceId");
  if (!spaceId || !z.uuid().safeParse(spaceId).success) throw new HttpError(400, "חסר מזהה מרחב");
  return ok(await listTasks({ spaceIds: [spaceId] }));
});

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, taskCreateSchema);
  if (!(await getSpace(input.spaceId))) throw new HttpError(404, "המרחב לא נמצא");
  const [task] = await createTasks([input]);
  return ok(task, 201);
});
