// ENG-05 item 4 — soumission `valid_until` snaps to END OF DAY America/Montreal on the
// calendar date of (prepared_at's Montreal date + SOUMISSION_VALIDITY_DAYS). DST-aware. The
// page PRINTS a date, so the link must stay live for ALL of that printed date — a soumission
// that 410s at 20:30 on the day it says it's valid is a document that lies. Only ever extends.
//
// No timezone dependency (#34: pg-only). Uses the built-in Intl/ICU: read the wall-clock parts
// in the zone, then invert to the UTC instant with a two-pass offset correction (DST edges).

const MONTREAL = "America/Montreal";

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

function partsInTz(utcMs: number, tz: string): Wall {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) if (p.type !== "literal") m[p.type] = p.value;
  return { y: +m.year, mo: +m.month, d: +m.day, h: +m.hour % 24, mi: +m.minute, s: +m.second };
}

// The zone's offset (localWallAsUTC − utc) in ms at the given instant. Compare against utcMs
// FLOORED to the second: partsInTz has second precision, and zone offsets are whole minutes, so
// this yields the exact offset free of any sub-second skew in utcMs.
function tzOffsetMs(utcMs: number, tz: string): number {
  const p = partsInTz(utcMs, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(utcMs / 1000) * 1000;
}

// The UTC instant for a wall-clock time in `tz` (DST-aware; two passes settle transition edges).
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, tz: string): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  let utc = naive - tzOffsetMs(naive, tz);
  utc = naive - tzOffsetMs(utc, tz);
  return utc;
}

// valid_until = 23:59:59.999 America/Montreal on (Montreal date of prepared_at) + validityDays.
export function soumissionValidUntil(preparedMs: number, validityDays: number, tz: string = MONTREAL): number {
  const p = partsInTz(preparedMs, tz);
  const target = new Date(Date.UTC(p.y, p.mo - 1, p.d + validityDays)); // calendar-day add (rolls month/year)
  return wallToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 23, 59, 59, 999, tz);
}
