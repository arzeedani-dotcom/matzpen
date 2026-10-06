/** GET /api/agent/usage — this month's agent spend against the hard monthly cap. */
import { getUsage } from "@/lib/agent/budget";
import { handle, ok } from "@/lib/http";

export const runtime = "nodejs";

export const GET = handle(async () => ok(await getUsage()));
