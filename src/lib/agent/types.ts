/**
 * The contract between the chat window (browser) and the agent (server).
 *
 * POST /api/agent/chat     body: ChatRequest      → NDJSON stream of AgentEvent, one JSON object per line
 * POST /api/agent/confirm  body: ConfirmRequest   → NDJSON stream of AgentEvent (same as chat)
 *
 * The stream always ends with exactly one "final" or "error" event.
 */

/** Which spaces the agent may see and touch. "all" means every space that exists at request time. */
export type AgentScope = { mode: "all" } | { mode: "spaces"; spaceIds: string[] };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Conversation so far, oldest first, ending with the new user message. The client sends at most the last 20. */
  messages: ChatMessage[];
  scope: AgentScope;
  /** The confirmation card open in this chat, if any. A bare "כן"/"לא" answers this card and no other. */
  pendingId?: string;
}

export interface ConfirmRequest {
  pendingId: string;
  decision: "confirm" | "cancel";
  scope: AgentScope;
}

/** A write the server refused to run without a "yes". */
export interface PendingActionView {
  id: string;
  kind: "add" | "update" | "delete";
  /** Hebrew, e.g. "לדחות 7 משימות למחר (7.10)". */
  summary: string;
  /** How many tasks will change. */
  count: number;
  /** The affected tasks, for the confirmation card. */
  items: { id: string | null; title: string; spaceName: string }[];
  expiresAt: string;
}

export type AgentEvent =
  /** Progress line for the header of the chat, e.g. "קורא משימות…". */
  | { type: "step"; text: string }
  | {
      type: "final";
      /** Short answer in the user's language. */
      reply: string;
      /** True when tasks were written — the client must refetch all data. */
      changed: boolean;
      /** Present when an action waits for confirmation. */
      pending?: PendingActionView;
    }
  | { type: "error"; message: string };

/** More than this many tasks in one write requires confirmation. Deletes always do. */
export const CONFIRM_THRESHOLD = 3;
export const PENDING_TTL_MINUTES = 10;
export const MAX_TOOL_ROUNDS = 6;
export const MAX_HISTORY = 20;
