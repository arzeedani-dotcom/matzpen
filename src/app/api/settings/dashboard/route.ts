import { z } from "zod";
import { DASHBOARD_SPACES_KEY, getSetting, setSetting } from "@/lib/repo";
import { handle, ok, parseBody } from "@/lib/http";

/** The dashboard's space selection. `null` = all spaces (also covers spaces created later). */
const bodySchema = z.object({ spaceIds: z.array(z.uuid()).max(200).nullable() });

export const GET = handle(async () => ok({ spaceIds: (await getSetting<{ ids: string[] | null }>(DASHBOARD_SPACES_KEY, { ids: null })).ids }));

export const PUT = handle(async (req: Request) => {
  const { spaceIds } = await parseBody(req, bodySchema);
  await setSetting(DASHBOARD_SPACES_KEY, { ids: spaceIds });
  return ok({ spaceIds });
});
