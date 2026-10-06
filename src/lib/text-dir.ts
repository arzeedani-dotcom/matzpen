/**
 * Base direction for user text. `dir="auto"` looks only at the FIRST strong letter, so a
 * Hebrew title that opens with a brand ("zeedani.com — לחבר את…") turns left-to-right and its
 * parts read out of order, and an empty input pushes its Hebrew placeholder to the wrong side.
 * Here any Hebrew or Arabic letter makes the text right-to-left; only text with Latin letters
 * and no RTL letter at all is left-to-right; empty text follows the page (RTL).
 */
const RTL_LETTER = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_LETTER = /[A-Za-zÀ-ɏ]/;

export function textDir(text: string | null | undefined): "rtl" | "ltr" {
  if (!text || RTL_LETTER.test(text)) return "rtl";
  return LTR_LETTER.test(text) ? "ltr" : "rtl";
}
