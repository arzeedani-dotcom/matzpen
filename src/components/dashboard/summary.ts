/**
 * The one-line, plain-Hebrew summary under the dashboard date:
 * "2 משימות באיחור, 2 להיום ו־2 דחופות." — the first phrase carries the noun,
 * the rest lean on it, and a lone "1" reads as a word ("אחת").
 */

type Kind = "overdue" | "today" | "urgent";

const PHRASES: Record<Kind, { firstOne: string; first: (n: number) => string; laterOne: string; later: (n: number) => string }> = {
  overdue: {
    firstOne: "משימה אחת באיחור",
    first: (n) => `${n} משימות באיחור`,
    laterOne: "אחת באיחור",
    later: (n) => `${n} באיחור`,
  },
  today: {
    firstOne: "משימה אחת להיום",
    first: (n) => `${n} משימות להיום`,
    laterOne: "אחת להיום",
    later: (n) => `${n} להיום`,
  },
  urgent: {
    firstOne: "משימה דחופה אחת",
    first: (n) => `${n} משימות דחופות`,
    laterOne: "אחת דחופה",
    later: (n) => `${n} דחופות`,
  },
};

/** Hebrew "and": a maqaf before a digit (ו־2), joined to a word (ואחת). */
const and = (phrase: string) => (/^\d/.test(phrase) ? `ו־${phrase}` : `ו${phrase}`);

function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${and(parts[parts.length - 1])}`;
}

export function summarize(counts: { overdue: number; today: number; urgent: number }): string {
  const { overdue, today, urgent } = counts;

  if (!overdue && !today) {
    if (!urgent) return "אין שום דבר באיחור או להיום.";
    return urgent === 1
      ? "אין שום דבר באיחור או להיום. משימה דחופה אחת מחכה."
      : `אין שום דבר באיחור או להיום. ${urgent} משימות דחופות מחכות.`;
  }

  const kinds = (["overdue", "today", "urgent"] as const).filter((k) => counts[k] > 0);
  const parts = kinds.map((k, i) => {
    const n = counts[k];
    const p = PHRASES[k];
    if (i === 0) return n === 1 ? p.firstOne : p.first(n);
    return n === 1 ? p.laterOne : p.later(n);
  });
  const sentence = join(parts);
  return overdue ? `${sentence}.` : `${sentence}, ושום דבר לא באיחור.`;
}
