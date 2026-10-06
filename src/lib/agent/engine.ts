/**
 * The agent loop: OpenAI Chat Completions with function calling, at most
 * MAX_TOOL_ROUNDS rounds per message. Emits "step" events while tools run and
 * exactly one "final" or "error" at the end. Every call is gated by the monthly
 * budget, and a write that needs confirmation stops the loop.
 */
import "server-only";
import OpenAI, { APIConnectionTimeoutError, APIError } from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { instance } from "@/config/instance";
import { todayIn } from "@/lib/dates";
import {
  BudgetExceededError,
  checkBudget,
  estimateCallUsd,
  MAX_OUTPUT_TOKENS,
  recordUsage,
  releaseReservation,
} from "./budget";
import { confirmPending, findLivePending, resolveScope, supersedePending } from "./guard";
import { buildSystemPrompt } from "./prompt";
import { executeTool, stepText, TOOL_DEFINITIONS } from "./tools";
import {
  MAX_HISTORY,
  MAX_TOOL_ROUNDS,
  type AgentEvent,
  type ChatMessage,
  type ChatRequest,
  type PendingActionView,
} from "./types";

/** The slice of the OpenAI client the engine uses — tests pass a fake. */
export interface ChatClient {
  chat: { completions: { create(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> } };
}

export interface AgentDeps {
  client?: ChatClient;
  now?: () => Date;
}

const MAX_MESSAGE_CHARS = 4000;

/** Last MAX_HISTORY messages, starting with a user turn, each capped in length. */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-MAX_HISTORY);
  const firstUser = recent.findIndex((m) => m.role === "user");
  return (firstUser < 0 ? [] : recent.slice(firstUser)).map((m) => ({
    role: m.role,
    content: m.content.length > MAX_MESSAGE_CHARS ? `${m.content.slice(0, MAX_MESSAGE_CHARS)}…` : m.content,
  }));
}

const YES = new Set([
  "כן", "כן בבקשה", "כן תודה", "מאשר", "מאשרת", "אשר", "אישור", "בצע", "סבבה", "אוקיי", "יאללה",
  "نعم", "اه", "آه", "أيوه", "ايوه", "موافق", "موافقة", "أوافق", "اوافق", "تمام", "نفذ", "نفّذ",
  "yes", "y", "ok", "okay", "confirm",
]);
const NO = new Set([
  "לא", "לא תודה", "לא מאשר", "לא מאשרת", "בטל", "ביטול", "עזוב",
  "لا", "إلغاء", "الغاء", "ألغ", "الغي", "لا أوافق", "لا اوافق",
  "no", "n", "cancel",
]);

/** A bare "yes"/"no" (as a reply to a confirmation card), or null for anything else. */
export function parseYesNo(text: string): "confirm" | "cancel" | null {
  const t = text
    .normalize("NFKC")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[.!,،?؟\s👍🙏✅❌]+$/u, "")
    .replace(/^[\s]+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (YES.has(t)) return "confirm";
  if (NO.has(t)) return "cancel";
  return null;
}

const KEY_RE = /sk-[A-Za-z0-9_-]{6,}/g;

function logError(e: unknown): void {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const extra = e instanceof APIError ? ` status=${e.status} code=${e.code ?? ""} request=${e.requestID ?? ""}` : "";
  console.error(`[agent] ${msg}${extra}`.replace(KEY_RE, "sk-***"));
}

function hebrewError(e: unknown): string {
  if (e instanceof BudgetExceededError) return e.message;
  if (e instanceof APIConnectionTimeoutError) return "OpenAI לא ענה בזמן. נסה שוב בעוד רגע.";
  if (e instanceof APIError) {
    if (e.status === 401) return "מפתח OpenAI שגוי או לא פעיל.";
    if (e.status === 403) return "לחשבון OpenAI אין הרשאה למודל הזה.";
    if (e.status === 404) return "המודל שהוגדר אינו זמין בחשבון OpenAI.";
    if (e.status === 429) return "OpenAI עמוס כרגע או שהמכסה בחשבון נגמרה. נסה שוב בעוד רגע.";
    return "שגיאה בחיבור ל-OpenAI. נסה שוב בעוד רגע.";
  }
  return "שגיאה בשרת. נסה שוב בעוד רגע.";
}

function defaultClient(): ChatClient | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, maxRetries: 1, timeout: 25_000 });
}

/** Rough size of what we send — for the budget reservation. */
function promptChars(messages: ChatCompletionMessageParam[]): number {
  return JSON.stringify(messages).length + JSON.stringify(TOOL_DEFINITIONS).length;
}

export async function runAgent(req: ChatRequest, emit: (e: AgentEvent) => void, deps: AgentDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  let changed = false;
  try {
    const history = trimHistory(req.messages);
    const last = history.at(-1);
    if (!last || last.role !== "user") {
      emit({ type: "error", message: "ההודעה האחרונה חייבת להיות של המשתמש." });
      return;
    }

    // A typed "כן"/"לא" answers the live confirmation card — no model involved.
    const yesNo = history.length > 1 ? parseYesNo(last.content) : null;
    if (yesNo) {
      const pendingId = await findLivePending(now());
      if (pendingId) {
        emit({ type: "step", text: yesNo === "confirm" ? "מבצע…" : "מבטל…" });
        const r = await confirmPending(pendingId, yesNo, req.scope, now());
        emit({ type: "final", reply: r.reply, changed: r.changed });
        return;
      }
    }

    const client = deps.client ?? defaultClient();
    if (!client) {
      emit({ type: "error", message: "הסוכן לא מוגדר: חסר מפתח OpenAI" });
      return;
    }

    // Any other message makes an older confirmation card stale.
    await supersedePending();

    const scope = await resolveScope(req.scope);
    const today = todayIn(instance.timeZone, now());
    const ctx = { scope, today };
    const messages: ChatCompletionMessageParam[] = [
      { role: "developer", content: buildSystemPrompt({ today, spaces: scope.spaces }) },
      ...history,
    ];
    const model = process.env.OPENAI_MODEL || instance.defaultModel;
    let withReasoning = true;

    const call = async (toolChoice: "auto" | "none"): Promise<ChatCompletionMessage> => {
      const body: ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: toolChoice,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        prompt_cache_key: "matzpen-agent",
        ...(withReasoning ? { reasoning_effort: "low" as const } : {}),
      };
      const reservation = await checkBudget(estimateCallUsd(promptChars(messages)), now());
      let completion: ChatCompletion;
      try {
        completion = await client.chat.completions.create(body);
      } catch (e) {
        // A timed-out call may still be billed — keep it charged; other failures are free.
        if (e instanceof APIConnectionTimeoutError) await recordUsage(reservation, null);
        else await releaseReservation(reservation);
        // Models without reasoning support reject the parameter: retry once without it.
        if (withReasoning && e instanceof APIError && e.status === 400 && /reasoning/i.test(`${e.param} ${e.message}`)) {
          withReasoning = false;
          return call(toolChoice);
        }
        throw e;
      }
      await recordUsage(reservation, completion.usage);
      const msg = completion.choices[0]?.message;
      if (!msg) throw new Error("OpenAI returned no choices");
      return msg;
    };

    let pending: PendingActionView | undefined;
    let reply: string | null = null;
    for (let round = 0; round < MAX_TOOL_ROUNDS && !pending; round++) {
      const msg = await call("auto");
      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        reply = msg.content ?? msg.refusal ?? null;
        break;
      }
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
      for (const tc of calls) {
        let output: string;
        if (tc.type !== "function") {
          output = JSON.stringify({ error: "כלי לא נתמך" });
        } else if (pending) {
          output = JSON.stringify({ error: "לא בוצע: יש פעולה שממתינה לאישור. אל תפעיל כלים נוספים." });
        } else {
          emit({ type: "step", text: stepText(tc.function.name, tc.function.arguments) });
          const r = await executeTool(tc.function.name, tc.function.arguments, ctx);
          output = r.output;
          changed ||= r.changed;
          pending ??= r.pending;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }
    }

    // A pending action, or the round limit, ends tool use: one last turn just for the words.
    if (reply === null) {
      const msg = await call("none");
      reply = msg.content ?? msg.refusal ?? null;
    }
    const text =
      reply?.trim() ||
      (pending
        ? `${pending.summary} — נדרש אישור. אפשר לאשר בכפתורים או לכתוב "כן".`
        : "לא הצלחתי להשלים את הבקשה. נסה לנסח אותה בצורה ממוקדת יותר.");
    emit({ type: "final", reply: text, changed, ...(pending ? { pending } : {}) });
  } catch (e) {
    if (!(e instanceof BudgetExceededError)) logError(e);
    const message = hebrewError(e);
    // Writes already done must still reach the client, so it refetches.
    if (changed) emit({ type: "final", reply: `${message} (חלק מהפעולות כבר בוצעו והמסך עודכן.)`, changed: true });
    else emit({ type: "error", message });
  }
}

/**
 * Wraps a run in an NDJSON streaming Response: one JSON object per line, and
 * always exactly one terminal ("final" | "error") event.
 */
export function ndjsonResponse(run: (emit: (e: AgentEvent) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let done = false;
      const emit = (e: AgentEvent) => {
        if (done) return;
        if (e.type !== "step") done = true;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // client went away
        }
      };
      try {
        await run(emit);
      } catch (e) {
        logError(e);
        emit({ type: "error", message: "שגיאה בשרת. נסה שוב בעוד רגע." });
      }
      if (!done) emit({ type: "error", message: "שגיאה בשרת. נסה שוב בעוד רגע." });
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
