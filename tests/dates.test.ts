import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  formatDue,
  formatLongHebrew,
  isOverdue,
  isValidISODate,
  monthGrid,
  todayIn,
  weekStart,
} from "@/lib/dates";

describe("todayIn", () => {
  it("uses the Jerusalem calendar day, not UTC", () => {
    // 22:30 UTC on Oct 5 is already 01:30 on Oct 6 in Jerusalem (UTC+3 in October).
    expect(todayIn("Asia/Jerusalem", new Date("2026-10-05T22:30:00Z"))).toBe("2026-10-06");
    expect(todayIn("UTC", new Date("2026-10-05T22:30:00Z"))).toBe("2026-10-05");
  });
  it("handles winter time (UTC+2)", () => {
    expect(todayIn("Asia/Jerusalem", new Date("2026-12-31T21:59:00Z"))).toBe("2026-12-31");
    expect(todayIn("Asia/Jerusalem", new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("is not affected by daylight-saving changes", () => {
    // Israel moves clocks on 2026-10-25; date arithmetic must still be exact.
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("weeks", () => {
  it("knows the weekday (0 = Sunday)", () => {
    expect(dayOfWeek("2026-10-04")).toBe(0);
    expect(dayOfWeek("2026-10-06")).toBe(2);
  });
  it("starts the week on Sunday", () => {
    expect(weekStart("2026-10-06", 0)).toBe("2026-10-04");
    expect(weekStart("2026-10-04", 0)).toBe("2026-10-04");
    expect(weekStart("2026-10-03", 0)).toBe("2026-09-27");
  });
});

describe("isOverdue", () => {
  it("is overdue only when the due date passed and the task is open", () => {
    expect(isOverdue({ dueDate: "2026-10-05", status: "new" }, "2026-10-06")).toBe(true);
    expect(isOverdue({ dueDate: "2026-10-06", status: "new" }, "2026-10-06")).toBe(false);
    expect(isOverdue({ dueDate: "2026-10-01", status: "done" }, "2026-10-06")).toBe(false);
    expect(isOverdue({ dueDate: null, status: "new" }, "2026-10-06")).toBe(false);
  });
});

describe("monthGrid", () => {
  it("returns whole weeks starting on Sunday that cover the month", () => {
    const grid = monthGrid(2026, 9, 0); // October 2026 starts on a Thursday
    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe("2026-09-27");
    expect(grid).toContain("2026-10-01");
    expect(grid).toContain("2026-10-31");
    expect(dayOfWeek(grid[0])).toBe(0);
  });
  it("handles February starting on Sunday", () => {
    const grid = monthGrid(2026, 1, 0); // Feb 1 2026 is a Sunday
    expect(grid[0]).toBe("2026-02-01");
    expect(grid.length).toBe(28);
  });
});

describe("formatDue", () => {
  const today = "2026-10-06";
  it("names overdue, today and tomorrow", () => {
    expect(formatDue("2026-10-05", today)).toEqual({ text: "באיחור של יום", tone: "overdue" });
    expect(formatDue("2026-10-04", today)).toEqual({ text: "באיחור של יומיים", tone: "overdue" });
    expect(formatDue("2026-10-01", today)).toEqual({ text: "באיחור של 5 ימים", tone: "overdue" });
    expect(formatDue("2026-10-06", today)).toEqual({ text: "היום", tone: "today" });
    expect(formatDue("2026-10-07", today)).toEqual({ text: "מחר", tone: "tomorrow" });
  });
  it("writes other dates as a short Hebrew date", () => {
    expect(formatDue("2026-10-09", today)).toEqual({ text: "ו׳ 9 באוק׳", tone: "normal" });
  });
  it("does not call a completed task overdue", () => {
    expect(formatDue("2026-10-01", today, "done").tone).toBe("normal");
  });
});

describe("formatLongHebrew", () => {
  it("writes a full Hebrew date", () => {
    expect(formatLongHebrew("2026-10-06")).toBe("יום שלישי, 6 באוקטובר 2026");
  });
});

describe("isValidISODate", () => {
  it("accepts real dates only", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("06/10/2026")).toBe(false);
  });
});

describe("textDir", () => {
  it("is RTL whenever Hebrew or Arabic appears, LTR only for Latin-only text, RTL when empty", async () => {
    const { textDir } = await import("@/lib/text-dir");
    expect(textDir("zeedani.com — לחבר את Resend")).toBe("rtl");
    expect(textDir("OpenAI — לבדוק את המכסה")).toBe("rtl");
    expect(textDir("الذكاء الاصطناعي")).toBe("rtl");
    expect(textDir("Buy milk")).toBe("ltr");
    expect(textDir("")).toBe("rtl");
    expect(textDir("2026")).toBe("rtl");
  });
});
