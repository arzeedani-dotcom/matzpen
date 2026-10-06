import { z } from "zod";
import { reorderSpaces } from "@/lib/repo";
import { handle, ok, parseBody } from "@/lib/http";

const bodySchema = z.object({ ids: z.array(z.uuid()).max(200) });

export const POST = handle(async (req: Request) => {
  const { ids } = await parseBody(req, bodySchema);
  await reorderSpaces(ids);
  return ok({ ok: true });
});
