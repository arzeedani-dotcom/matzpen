/** POST /api/agent/confirm — approves or cancels a pending agent action; streams NDJSON AgentEvents. */
import { z } from "zod";
import { ndjsonResponse } from "@/lib/agent/engine";
import { agentScopeSchema, confirmPending } from "@/lib/agent/guard";
import { handle, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  pendingId: z.uuid("מזהה פעולה לא תקין"),
  decision: z.enum(["confirm", "cancel"]),
  scope: agentScopeSchema,
});

export const POST = handle(async (req: Request) => {
  const { pendingId, decision, scope } = await parseBody(req, bodySchema);
  return ndjsonResponse(async (emit) => {
    emit({ type: "step", text: decision === "confirm" ? "מבצע…" : "מבטל…" });
    const r = await confirmPending(pendingId, decision, scope);
    emit({ type: "final", reply: r.reply, changed: r.changed });
  });
});
