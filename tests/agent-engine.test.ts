import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db", async () => (await import("./helpers/test-db")).dbModule());
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { resetDb } from "./helpers/test-db";
import { db } from "@/db";
import { agentUsage } from "@/db/schema";
import { createSpace, createTasks, listTasks } from "@/lib/repo";
import { checkBudget, costOf, getUsage, monthKey, recordUsage } from "@/lib/agent/budget";
import { ndjsonResponse, parseYesNo, runAgent, trimHistory, type ChatClient } from "@/lib/agent/engine";
import { MAX_HISTORY, MAX_TOOL_ROUNDS, type AgentEvent, type ChatMessage } from "@/lib/agent/types";

beforeEach(() => resetDb());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Reply = { content?: string; calls?: { name: string; args: unknown }[] };

function completion(r: Reply, n: number): ChatCompletion {
  return {
    id: `c${n}`,
    object: "chat.completion",
    created: 0,
    model: "gpt-6-luna",
    choices: [
      {
        index: 0,
        finish_reason: r.calls ? "tool_calls" : "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content: r.content ?? null,
          refusal: null,
          tool_calls: r.calls?.map((c, i) => ({
            id: `call_${n}_${i}`,
            type: "function" as const,
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
      },
    ],
    usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
  };
}

/** A scripted OpenAI stand-in: returns the replies in order and records every request. */
function fakeClient(replies: Reply[]) {
  const bodies: ChatCompletionCreateParamsNonStreaming[] = [];
  let i = 0;
  const create = vi.fn(async (body: ChatCompletionCreateParamsNonStreaming) => {
    bodies.push(structuredClone(body));
    const r = replies[Math.min(i, replies.length - 1)];
    return completion(r, i++);
  });
  const client: ChatClient = { chat: { completions: { create } } };
  return { client, create, bodies };
}

async function collect(messages: ChatMessage[], client?: ChatClient, now?: Date) {
  const events: AgentEvent[] = [];
  await runAgent({ messages, scope: { mode: "all" } }, (e) => events.push(e), {
    client,
    now: now ? () => now : undefined,
  });
  return { events, final: events.at(-1)! };
}

const user = (content: string): ChatMessage => ({ role: "user", content });

describe("engine loop", () => {
  it("runs a tool call, feeds the result back, and ends with one final event", async () => {
    await createSpace({ name: "בית", color: "emerald", view: "list" });
    const { client, create, bodies } = fakeClient([
      { calls: [{ name: "add_tasks", args: { tasks: [{ title: "לקנות חלב", space: "בית" }, { title: "ארנונה", space: "בית" }] } }] },
      { content: "הוספתי 2 משימות לבית." },
    ]);
    const { events, final } = await collect([user("תוסיף לבית: לקנות חלב, ארנונה")], client);
    expect(events.filter((e) => e.type === "step")).toEqual([{ type: "step", text: "מוסיף 2 משימות…" }]);
    expect(final).toEqual({ type: "final", reply: "הוספתי 2 משימות לבית.", changed: true });
    expect(events.filter((e) => e.type === "final" || e.type === "error")).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(await listTasks()).toHaveLength(2);

    const first = bodies[0];
    expect(first.model).toBe("gpt-6-luna");
    expect(first.reasoning_effort).toBe("low");
    expect(first.max_completion_tokens).toBe(1200);
    expect(first.tools).toHaveLength(5);
    expect(first.messages[0].role).toBe("developer");
    const second = bodies[1].messages;
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_0_0" });
    expect(JSON.parse(second.at(-1)!.content as string)).toMatchObject({ executed: true, added: 2 });
  });

  it("uses OPENAI_MODEL when set", async () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-6-sol");
    const { client, bodies } = fakeClient([{ content: "שלום" }]);
    await collect([user("היי")], client);
    expect(bodies[0].model).toBe("gpt-6-sol");
  });

  it("stops the loop on a pending action and returns it", async () => {
    const s = await createSpace({ name: "בית", color: "emerald", view: "list" });
    const tasks = await createTasks([1, 2, 3, 4].map((i) => ({ spaceId: s.id, title: `t${i}` })));
    const { client, create, bodies } = fakeClient([
      {
        calls: [
          { name: "update_tasks", args: { ids: tasks.map((t) => t.id), changes: { dueDate: "2026-10-07" } } },
          { name: "delete_tasks", args: { ids: [tasks[0].id] } },
        ],
      },
      { content: "זה ידחה 4 משימות למחר. לאשר?" },
    ]);
    const { final } = await collect([user("תדחה הכל למחר")], client);
    expect(final).toMatchObject({ type: "final", reply: "זה ידחה 4 משימות למחר. לאשר?", changed: false });
    expect(final.type === "final" && final.pending).toMatchObject({ kind: "update", count: 4 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(bodies[1].tool_choice).toBe("none");
    // The second call in the same round was answered but not run.
    const toolMsgs = bodies[1].messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(String(toolMsgs[1].content)).toContain("ממתינה לאישור");
    expect((await listTasks()).every((t) => t.dueDate === null)).toBe(true);
  });

  it("caps tool rounds, then asks for words only", async () => {
    await createSpace({ name: "בית", color: "emerald", view: "list" });
    const { client, create, bodies } = fakeClient([{ calls: [{ name: "read_tasks", args: {} }] }]);
    const { final } = await collect([user("תקרא")], client);
    expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(bodies.at(-1)!.tool_choice).toBe("none");
    expect(final.type).toBe("final");
  });

  it("trims history to MAX_HISTORY and starts with a user turn", async () => {
    const long: ChatMessage[] = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i}`,
    }));
    const trimmed = trimHistory(long);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(trimmed[0].role).toBe("user");
    expect(trimmed.at(-1)!.content).toBe("m30");

    const { client, bodies } = fakeClient([{ content: "בסדר" }]);
    await collect(long, client);
    expect(bodies[0].messages).toHaveLength(trimmed.length + 1);
  });

  it("reports a missing key as an error event", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { events } = await collect([user("היי")]);
    expect(events).toEqual([{ type: "error", message: "הסוכן לא מוגדר: חסר מפתח OpenAI" }]);
  });

  it("turns OpenAI failures into a Hebrew error without leaking the key", async () => {
    const { APIError } = await import("openai");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client: ChatClient = {
      chat: {
        completions: {
          create: async () => {
            throw new APIError(401, { message: "Incorrect API key provided: sk-proj-abcdef123456" }, undefined, new Headers());
          },
        },
      },
    };
    const { events } = await collect([user("היי")], client);
    expect(events).toEqual([{ type: "error", message: "מפתח OpenAI שגוי או לא פעיל." }]);
    expect(String(log.mock.calls[0][0])).not.toContain("abcdef123456");
  });

  it("answers a typed yes/no to the live pending action without the model", async () => {
    const s = await createSpace({ name: "בית", color: "emerald", view: "list" });
    const tasks = await createTasks([1, 2].map((i) => ({ spaceId: s.id, title: `t${i}` })));
    const { client } = fakeClient([
      { calls: [{ name: "delete_tasks", args: { ids: tasks.map((t) => t.id) } }] },
      { content: "למחוק 2 משימות? אפשר לאשר." },
    ]);
    await collect([user("תמחק הכל")], client);
    const { create } = fakeClient([{ content: "x" }]);
    const silent: ChatClient = { chat: { completions: { create } } };
    const { final } = await collect(
      [user("תמחק הכל"), { role: "assistant", content: "למחוק 2 משימות?" }, user("כן!")],
      silent,
    );
    expect(final).toEqual({ type: "final", reply: "בוצע: נמחקו 2 משימות.", changed: true });
    expect(create).not.toHaveBeenCalled();
    expect(await listTasks()).toHaveLength(0);
  });

  it("parses bare yes/no in Hebrew, Arabic and English only", () => {
    expect(parseYesNo(" כן ")).toBe("confirm");
    expect(parseYesNo("نعم.")).toBe("confirm");
    expect(parseYesNo("לא")).toBe("cancel");
    expect(parseYesNo("لا")).toBe("cancel");
    expect(parseYesNo("כן, ותוסיף גם חלב")).toBeNull();
  });
});

describe("budget", () => {
  const OCT = new Date("2026-10-15T10:00:00Z");

  it("blocks the call when the cap would be crossed — OpenAI is never invoked", async () => {
    await db().insert(agentUsage).values({ month: monthKey(OCT), costUsd: 0.9999 });
    const { client, create } = fakeClient([{ content: "x" }]);
    const { events } = await collect([user("היי")], client, OCT);
    expect(create).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "הגעתי לתקרת התקציב החודשית של הסוכן ($1). הוא יחזור לפעול ב-1 בחודש הבא. כל שאר המערכת ממשיכה לעבוד כרגיל.",
    });
    expect((await getUsage(OCT)).costUsd).toBe(0.9999);
  });

  it("checks before every round, not just per message", async () => {
    await createSpace({ name: "בית", color: "emerald", view: "list" });
    vi.stubEnv("AGENT_MONTHLY_BUDGET_USD", "0.0012");
    const { client, create } = fakeClient([{ calls: [{ name: "read_tasks", args: {} }] }]);
    const { events } = await collect([user("תקרא")], client, OCT);
    expect(create.mock.calls.length).toBeGreaterThan(0);
    expect(create.mock.calls.length).toBeLessThan(MAX_TOOL_ROUNDS + 1);
    expect(events.at(-1)!.type).toBe("error");
    const u = await getUsage(OCT);
    expect(u.costUsd).toBeLessThanOrEqual(0.0012);
    expect(u.budgetUsd).toBe(0.0012);
  });

  it("accumulates real usage across calls and swaps the reservation for actual cost", async () => {
    const { client } = fakeClient([{ content: "א" }]);
    await collect([user("היי")], client, OCT);
    await collect([user("שוב")], client, OCT);
    const u = await getUsage(OCT);
    expect(u.requests).toBe(2);
    expect(u.costUsd).toBeCloseTo(2 * costOf(1000, 100), 9);
    const [row] = await db().select().from(agentUsage);
    expect(row).toMatchObject({ inputTokens: 2000, outputTokens: 200 });
  });

  it("starts each month from zero", async () => {
    await db().insert(agentUsage).values({ month: "2026-10", costUsd: 1 });
    const nov = new Date("2026-11-01T00:30:00+02:00"); // already November in Jerusalem
    expect(monthKey(nov)).toBe("2026-11");
    expect(monthKey(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11"); // 00:30 in Israel (UTC+2 after the clocks change)
    await expect(checkBudget(0.01, OCT)).rejects.toThrow("תקרת התקציב");
    const r = await checkBudget(0.01, nov);
    await recordUsage(r, { prompt_tokens: 100, completion_tokens: 10 });
    expect((await getUsage(nov)).costUsd).toBeCloseTo(costOf(100, 10), 9);
    expect((await getUsage(OCT)).costUsd).toBe(1);
  });
});

describe("ndjson stream", () => {
  it("writes one JSON per line and always ends with a terminal event", async () => {
    const res = ndjsonResponse(async (emit) => {
      emit({ type: "step", text: "קורא משימות…" });
    });
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([{ type: "step", text: "קורא משימות…" }, { type: "error", message: "שגיאה בשרת. נסה שוב בעוד רגע." }]);
  });
});
