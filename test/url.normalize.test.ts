import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/url/normalize.ts";

// Table A (N-01…N-30). Each row: id, input, and an assertion on the result.
// `id` asserts result.identity; `err` asserts a typed rejection; `note` /
// `classification` assert those fields; `same` asserts two inputs share identity.
type Case =
  | { id: string; input: string; identity: string; note?: string; classification?: string }
  | { id: string; input: string; err: string }
  | { id: string; a: string; b: string; same: true };

const CASES: Case[] = [
  { id: "N-01", input: "example.com", identity: "https://example.com/" },
  { id: "N-02", input: "  example.com  ", identity: "https://example.com/" },
  { id: "N-03", input: "EXAMPLE.COM", identity: "https://example.com/" },
  { id: "N-04", input: "example.com/Services/Plumbing", identity: "https://example.com/Services/Plumbing" },
  { id: "N-05a", input: "https://example.com:443/", identity: "https://example.com/" },
  { id: "N-05b", input: "http://example.com:80/", identity: "http://example.com/" },
  { id: "N-05c", input: "https://example.com:8080/", identity: "https://example.com:8080/", note: "unusual_port" },
  { id: "N-06", a: "example.com/services/", b: "example.com/services", same: true },
  { id: "N-07", input: "example.com/services#pricing", identity: "https://example.com/services" },
  { id: "N-08", input: "example.com/#services", identity: "https://example.com/" },
  { id: "N-09a", input: "example.com/?utm_source=x&utm_medium=y&fbclid=z&gclid=q&ref=a", identity: "https://example.com/" },
  { id: "N-09b", input: "example.com/?b=2&a=1&utm_source=x", identity: "https://example.com/?a=1&b=2" },
  { id: "N-10a", input: "example.com/?p=123", identity: "https://example.com/?p=123" },
  { id: "N-10b", input: "example.com/?page_id=7", identity: "https://example.com/?page_id=7" },
  { id: "N-11", input: "example.com/?p=123&utm_source=fb", identity: "https://example.com/?p=123" },
  { id: "N-12", a: "example.com/r%c3%a9novation", b: "example.com/rénovation", same: true },
  { id: "N-14", input: "example.com//services///plans", identity: "https://example.com/services/plans" },
  { id: "N-15", input: "example.com/a/./b/../c", identity: "https://example.com/a/c" },
  { id: "N-16a", input: "example.com/index.html", identity: "https://example.com/" },
  { id: "N-16b", input: "example.com/index.php", identity: "https://example.com/" },
  { id: "N-16c", input: "example.com/services/index.html", identity: "https://example.com/services" },
  { id: "N-17", input: "//example.com/x", identity: "https://example.com/x" },
  { id: "N-18", input: "https://user:pass@example.com", identity: "https://example.com/", note: "suspicious_input" },
  { id: "N-19a", input: "mailto:hi@example.com", err: "unsupported_scheme" },
  { id: "N-19b", input: "ftp://example.com", err: "unsupported_scheme" },
  { id: "N-19c", input: "file:///etc/passwd", err: "unsupported_scheme" },
  { id: "N-20a", input: "https:/example.com", identity: "https://example.com/", note: "repaired" },
  { id: "N-20b", input: "https//example.com", identity: "https://example.com/", note: "repaired" },
  { id: "N-21", input: "http://192.0.2.10", identity: "http://192.0.2.10/", note: "ip_literal" },
  { id: "N-22a", input: "facebook.com/plomberie-x", identity: "https://facebook.com/plomberie-x", classification: "no_owned_site" },
  { id: "N-22b", input: "business.site/mon-plombier", identity: "https://business.site/mon-plombier", classification: "no_owned_site" },
  { id: "N-23", input: "remax-quebec.com/courtier/jean", identity: "https://remax-quebec.com/courtier/jean", classification: "platform_profile" },
  { id: "N-24", input: "HTTP://WWW.EXAMPLE.CA:80//Services/../index.html?utm_source=fb#devis", identity: "http://www.example.ca/" },
  { id: "N-25", input: "https://example.com?x=1", identity: "https://example.com/?x=1" },
  { id: "N-26", input: "HTTPS://example.com", identity: "https://example.com/" },
  { id: "N-27", input: "example .com", err: "invalid_host" },
  { id: "N-28", input: "https://example.com/" + "a".repeat(2100), err: "too_long" },
  { id: "N-29", input: "example.com.", identity: "https://example.com/" },
];

for (const c of CASES) {
  test(`${c.id}`, () => {
    if ("same" in c) {
      const ra = normalize(c.a), rb = normalize(c.b);
      assert.equal(ra.ok && rb.ok && ra.identity === rb.identity, true, `${c.a} vs ${c.b}`);
      return;
    }
    const r = normalize(c.input);
    if ("err" in c) { assert.equal(r.ok, false); assert.equal(r.ok === false && r.error, c.err); return; }
    assert.equal(r.ok, true, `expected ok for ${c.input}`);
    if (r.ok) {
      assert.equal(r.identity, c.identity);
      if (c.note) assert.equal(r.notes.includes(c.note), true, `missing note ${c.note}`);
      if (c.classification) assert.equal(r.classification, c.classification);
    }
  });
}

// N-12 also asserts hex was uppercased
test("N-12 hex uppercased", () => {
  const r = normalize("example.com/r%c3%a9novation");
  assert.equal(r.ok && /%C3%A9/.test(r.identity), true);
});

// N-13 punycode host for accented .ca domains
test("N-13 punycode", () => {
  const r = normalize("plombier-montréal.ca");
  assert.equal(r.ok && /^xn--/.test(r.host) && r.host.endsWith(".ca"), true, r.ok ? r.host : "not ok");
});

// N-30 idempotence property over every ok input in the table
test("N-30 idempotence: normalize(normalize(x)) == normalize(x)", () => {
  const inputs = CASES.flatMap((c) => ("same" in c ? [c.a, c.b] : "err" in c ? [] : [c.input]));
  inputs.push("plombier-montréal.ca");
  for (const inp of inputs) {
    const once = normalize(inp);
    if (!once.ok) continue;
    const twice = normalize(once.identity);
    assert.equal(twice.ok, true, `re-normalize failed for ${inp} -> ${once.identity}`);
    if (twice.ok) assert.equal(twice.identity, once.identity, `not idempotent: ${inp}`);
  }
});
