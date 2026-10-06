/**
 * Browser side of the agent: sends a request and reads the NDJSON stream of AgentEvents.
 * Always resolves with exactly one terminal event ("final" or "error") — network and
 * server failures are turned into an "error" event so the chat has one path to render.
 */
"use client";

import type { AgentEvent, ChatRequest, ConfirmRequest } from "@/lib/agent/types";

type Terminal = Extract<AgentEvent, { type: "final" | "error" }>;

async function stream(path: string, body: unknown, onStep: (text: string) => void, signal?: AbortSignal): Promise<Terminal> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { type: "error", message: "אין חיבור לשרת. בדוק את החיבור לאינטרנט ונסה שוב." };
  }

  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return { type: "error", message: "פג תוקף הכניסה. מעביר לדף הכניסה…" };
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { type: "error", message: data?.error ?? "הסוכן לא זמין כרגע. נסה שוב בעוד רגע." };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: Terminal | null = null;

  const take = (line: string) => {
    if (!line.trim()) return;
    let event: AgentEvent;
    try {
      event = JSON.parse(line) as AgentEvent;
    } catch {
      return;
    }
    if (event.type === "step") onStep(event.text);
    else terminal = event;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        take(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    take(buffer + decoder.decode());
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { type: "error", message: "החיבור נקטע באמצע התשובה. נסה שוב." };
  }

  return terminal ?? { type: "error", message: "הסוכן לא החזיר תשובה. נסה שוב." };
}

export const agentApi = {
  chat: (body: ChatRequest, onStep: (text: string) => void, signal?: AbortSignal) => stream("/api/agent/chat", body, onStep, signal),
  confirm: (body: ConfirmRequest, onStep: (text: string) => void, signal?: AbortSignal) =>
    stream("/api/agent/confirm", body, onStep, signal),
};
