/**
 * A bare "yes"/"no" typed as the answer to a confirmation card. Shared by the server
 * (which runs or cancels the card's action) and the chat window (which marks the card).
 */
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
