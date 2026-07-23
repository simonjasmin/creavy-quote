// ENG-05 item 4 — soumission valid_until = END OF DAY (23:59:59.999) America/Montreal on
// (Montreal date of prepared_at) + SOUMISSION_VALIDITY_DAYS. DST-aware; pinned across both
// transitions. The guarantee: the link stays live for ALL of the date the page prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { soumissionValidUntil } from "../src/service/soumissionDates.ts";

const mtl = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montreal", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" }).format(new Date(ms));
const mtlDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montreal", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

test("SD-01 snaps to 23:59:59.999 Montreal on the printed date (covers the whole day)", () => {
  const v = soumissionValidUntil(Date.parse("2026-07-23T15:39:40.483Z"), 30);
  assert.equal(new Date(v).toISOString(), "2026-08-23T03:59:59.999Z"); // EDT (−4)
  assert.equal(mtl(v), "2026-08-22, 23:59:59.999");
});

test("SD-02 DST-aware across SPRING-FORWARD (prepared EST → target EDT, −4)", () => {
  // Mar 1 (EST) + 30 = Mar 31 — DST began Mar 8 → the target date is EDT
  const v = soumissionValidUntil(Date.parse("2026-03-01T12:00:00Z"), 30);
  assert.equal(new Date(v).toISOString(), "2026-04-01T03:59:59.999Z");
  assert.equal(mtl(v), "2026-03-31, 23:59:59.999");
});

test("SD-03 DST-aware across FALL-BACK (prepared EDT → target EST, −5)", () => {
  // Oct 20 (EDT) + 30 = Nov 19 — DST ended Nov 1 → the target date is EST (an hour later in UTC)
  const v = soumissionValidUntil(Date.parse("2026-10-20T12:00:00Z"), 30);
  assert.equal(new Date(v).toISOString(), "2026-11-20T04:59:59.999Z");
  assert.equal(mtl(v), "2026-11-19, 23:59:59.999");
});

test("SD-04 the EOD guarantee holds for any prepared instant; only ever EXTENDS", () => {
  for (const iso of ["2026-01-15T00:00:00Z", "2026-06-30T23:00:00Z", "2026-07-24T03:30:00Z", "2026-11-01T05:30:00Z", "2026-12-31T18:00:00Z"]) {
    const p = Date.parse(iso);
    const v = soumissionValidUntil(p, 30);
    // always end-of-day Montreal
    assert.match(mtl(v), /, 23:59:59\.999$/, `${iso}: not EOD Montreal`);
    // printed date = prepared Montreal date + 30 calendar days (read UTC components directly)
    const pd = mtlDate(p);
    const dt = new Date(Date.UTC(+pd.slice(0, 4), +pd.slice(5, 7) - 1, +pd.slice(8, 10) + 30));
    const expDate = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    assert.equal(mtlDate(v), expDate, `${iso}: wrong printed date`);
    // never shortens below the day's own start (EOD is the latest instant of that date)
    assert.ok(v > p, `${iso}: valid_until must be after prepared_at`);
  }
});
