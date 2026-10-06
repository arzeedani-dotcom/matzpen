/** POST /api/agent/chat — runs the agent on a conversation and streams NDJSON AgentEvents. */
import { z } from "zod";
import { runAgent, ndjsonResponse } from "@/lib/agent/engine";
import { agentScopeSchema } from "@/lib/agent/guard";
import { handle, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .min(1, "אין הודעות")
    .max(200)
    .refine((m) => m.at(-1)?.role === "user", "ההודעה האחרונה חייבת להיות של המשתמש")
    .refine((m) => m.at(-1)!.content.trim().length > 0, "ההודעה ריקה"),
  scope: agentScopeSchema,
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, bodySchema);
  return ndjsonResponse((emit) => runAgent(body, emit));
});
