/**
 * Everything that makes this deployment "someone's" lives here.
 * To clone Matzpen for a new client: edit this file, point DATABASE_URL at their
 * database, set their APP_PASSWORD and OPENAI_API_KEY — nothing else changes.
 */
export const instance = {
  productName: "מצפן",
  tagline: "המשימות שלך, בכיוון הנכון",
  ownerName: "עבד רחמן",
  /** IANA zone used for "today", "overdue" and "this week". */
  timeZone: "Asia/Jerusalem",
  /** 0 = Sunday. */
  weekStartsOn: 0 as 0 | 1,
  /** Postgres schema holding this app's tables — keeps them apart from anything else in the database. */
  dbSchema: "matzpen",
  /** Extra lines appended to the agent's system prompt: who the owner is and how they work. */
  agentPersona: [
    "הבעלים: עבד רחמן זיידאני — מהנדס ומטמיע פתרונות AI במוסדות, מרכזים חינוכיים ועמותות; מייסד ומנהל בדימוס של בית ספר למחוננים ומצטיינים בטמרה.",
    "הוא עובד בעברית ובערבית. ענה בשפה שבה נכתבה ההודעה האחרונה שלו (ברירת מחדל: עברית).",
  ],
  defaultModel: "gpt-6-luna",
  /**
   * Hard monthly ceiling for the agent, in USD. When reached, the agent pauses until
   * the 1st of next month; the rest of the app keeps working. Override with AGENT_MONTHLY_BUDGET_USD.
   */
  agentMonthlyBudgetUsd: 1,
  /** Price per 1M tokens for the model above (OpenAI list price, Oct 2026). Cached input is billed at full price here — deliberately conservative. */
  pricing: { inputPerMillion: 0.1, outputPerMillion: 0.5 },
} as const;

export type Instance = typeof instance;
