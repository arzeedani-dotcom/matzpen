import { z } from "zod";
import { deleteSpace, updateSpace } from "@/lib/repo";
import { HttpError, handle, ok, parseBody } from "@/lib/http";
import { spacePatchSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

async function spaceId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "המרחב לא נמצא");
  return id;
}

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = await spaceId(ctx);
  const space = await updateSpace(id, await parseBody(req, spacePatchSchema));
  if (!space) throw new HttpError(404, "המרחב לא נמצא");
  return ok(space);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const result = await deleteSpace(await spaceId(ctx));
  if (!result) throw new HttpError(404, "המרחב לא נמצא");
  return ok(result);
});
