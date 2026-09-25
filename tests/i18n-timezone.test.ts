// Regression coverage for the server-timezone bug reported by the user: timestamps on
// /admin/aktivnosti displayed 2h behind their actual Bosnia wall-clock time, because
// formatDate/formatDateTime/endOfDay read Date.prototype's process-local getters, and every
// runtime this app deploys to (this Docker container, Vercel) runs with TZ=UTC, not
// Europe/Sarajevo. These assertions are pinned against known UTC instants and their correct
// CEST/CET-converted values, so they'd fail under the old implementation regardless of
// whatever timezone the test process itself happens to run in.
import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, endOfDay, parseZonedDateTime, formatDateTimeLocalInput } from "@/lib/i18n";

describe("formatDate / formatDateTime (Europe/Sarajevo, not server-local)", () => {
  it("converts a UTC instant to Bosnia wall-clock time during CEST (UTC+2)", () => {
    // 2026-09-25 is well clear of the Oct 25, 2026 DST changeover.
    expect(formatDateTime(new Date("2026-09-25T12:21:27.616Z"))).toBe("25.09.2026. 14:21");
  });

  it("converts a UTC instant to Bosnia wall-clock time during CET (UTC+1)", () => {
    // 2026-01-15 is well clear of the Mar 29, 2026 DST changeover.
    expect(formatDateTime(new Date("2026-01-15T10:00:00.000Z"))).toBe("15.01.2026. 11:00");
  });

  it("rolls the displayed date over to the next day when the zone shift crosses midnight", () => {
    // 23:30 UTC + 2h (CEST) = 01:30 the next day in Sarajevo.
    expect(formatDate(new Date("2026-09-25T23:30:00.000Z"))).toBe("26.09.2026.");
  });

  it("accepts an ISO string the same as a Date instance", () => {
    expect(formatDateTime("2026-09-25T12:21:27.616Z")).toBe("25.09.2026. 14:21");
  });

  it("returns an empty string for null/undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
  });
});

describe("endOfDay (Europe/Sarajevo, not server-local)", () => {
  it("builds 23:59:59.999 Sarajevo time during CEST as the correct UTC instant", () => {
    expect(endOfDay("2026-09-25").toISOString()).toBe("2026-09-25T21:59:59.999Z");
  });

  it("builds 23:59:59.999 Sarajevo time during CET as the correct UTC instant", () => {
    expect(endOfDay("2026-01-15").toISOString()).toBe("2026-01-15T22:59:59.999Z");
  });

  it("includes a record timestamped late in the Sarajevo day that a naive UTC-midnight boundary would exclude", () => {
    // 22:00 Sarajevo time on 2026-09-25 (CEST) = 20:00 UTC — after a naive `new Date("2026-09-25")`
    // (UTC midnight) upper bound would already be exceeded on the wrong day, but still well
    // within the correct Sarajevo-day boundary.
    const recordedAt = new Date("2026-09-25T20:00:00.000Z");
    expect(recordedAt.getTime()).toBeLessThanOrEqual(endOfDay("2026-09-25").getTime());
  });
});

describe("parseZonedDateTime (datetime-local form fields, not server-local)", () => {
  it("interprets a datetime-local value as Bosnia wall-clock time during CEST, not server-local", () => {
    // A president typing "14:00" during CEST means 14:00 Sarajevo = 12:00 UTC — NOT what
    // `new Date("2026-09-25T14:00")` would give on a UTC server (14:00 UTC, 2h later than
    // intended). This is the actual governance bug: a mis-stored e-vote close time.
    expect(parseZonedDateTime("2026-09-25T14:00")?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  it("interprets a datetime-local value as Bosnia wall-clock time during CET", () => {
    expect(parseZonedDateTime("2026-01-15T09:30")?.toISOString()).toBe("2026-01-15T08:30:00.000Z");
  });

  it("returns null for an empty or missing value", () => {
    expect(parseZonedDateTime("")).toBeNull();
    expect(parseZonedDateTime(null)).toBeNull();
    expect(parseZonedDateTime(undefined)).toBeNull();
  });

  it("round-trips with formatDateTimeLocalInput (load-and-resubmit-unchanged is a no-op)", () => {
    const stored = parseZonedDateTime("2026-09-25T14:00")!;
    expect(formatDateTimeLocalInput(stored)).toBe("2026-09-25T14:00");
  });
});
