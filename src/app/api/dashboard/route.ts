import { z } from "zod";
import { getDashboard, listSpaces } from "@/lib/repo";
import { handle, ok, today } from "@/lib/http";

/** GET /api/dashboard?spaceIds=a,b — omitted means all spaces. Unknown ids are ignored. */
export const GET = handle(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("spaceIds");
  const existing = (await listSpaces()).map((s) => s.id);
  const ids =
    raw === null
      ? existing
      : raw.split(",").filter((id) => z.uuid().safeParse(id).success && existing.includes(id));
  return ok(await getDashboard(ids, today()));
});
