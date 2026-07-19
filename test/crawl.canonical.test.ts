import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCanonical } from "../src/crawl/canonical.ts";
import { FakeTransport, type Scenario } from "./helpers/replay.ts";

const tx = (s: Scenario) => new FakeTransport(s);
const page = (body = "<html><body><a href='/a'>a</a></body></html>") => ({ status: 200, body });

test("D-01 http → 301 → https (scheme_upgraded)", async () => {
  const r = await resolveCanonical(tx({ "http://x.ca/": { status: 301, location: "https://x.ca/" }, "https://x.ca/": page(), "https://www.x.ca/": { status: 404 } }), "http://x.ca/");
  assert.ok(r.notes.includes("scheme_upgraded")); assert.equal(r.origin, "https://x.ca");
});
test("D-02 apex → www 301 (canonical host = www)", async () => {
  const r = await resolveCanonical(tx({ "https://x.ca/": { status: 301, location: "https://www.x.ca/" }, "https://www.x.ca/": page() }), "https://x.ca/");
  assert.ok(r.notes.includes("host_normalized")); assert.equal(r.origin, "https://www.x.ca");
});
test("D-03 apex AND www both 200 → host_ambiguous, deterministic pick (www)", async () => {
  const r = await resolveCanonical(tx({ "https://x.ca/": page(), "https://www.x.ca/": page() }), "https://x.ca/");
  assert.ok(r.notes.includes("host_ambiguous")); assert.equal(r.origin, "https://www.x.ca");
});
test("D-04 cross-domain root redirect → domain_moved (re-anchor once)", async () => {
  const r = await resolveCanonical(tx({ "https://x.com/": { status: 301, location: "https://x.ca/" }, "https://x.ca/": page(), "https://www.x.ca/": { status: 404 } }), "https://x.com/");
  assert.ok(r.notes.includes("domain_moved")); assert.equal(r.origin, "https://x.ca");
});
test("D-04 second cross-domain hop → domain_moved_twice flag", async () => {
  const r = await resolveCanonical(tx({ "https://x.com/": { status: 301, location: "https://x.ca/" }, "https://x.ca/": { status: 301, location: "https://x.net/" }, "https://x.net/": page(), "https://www.x.net/": { status: 404 } }), "https://x.com/");
  assert.ok(r.review_flags.includes("domain_moved_twice"));
});
test("D-05 redirect chain ≤5 → one page, identity = final URL", async () => {
  const r = await resolveCanonical(tx({ "https://x.ca/": { status: 301, location: "https://x.ca/home" }, "https://x.ca/home": { status: 301, location: "https://x.ca/fr/accueil" }, "https://x.ca/fr/accueil": page(), "https://www.x.ca/": { status: 404 } }), "https://x.ca/");
  assert.equal(r.final_url, "https://x.ca/fr/accueil");
});
test("D-06 redirect loop → flagged", async () => {
  const r = await resolveCanonical(tx({ "https://x.ca/": { status: 301, location: "https://x.ca/" } }), "https://x.ca/");
  assert.ok(r.review_flags.includes("redirect_loop"));
});
test("D-07 meta-refresh treated as redirect", async () => {
  const r = await resolveCanonical(tx({ "https://x.ca/": { status: 200, body: `<html><head><meta http-equiv="refresh" content="0; url=https://x.ca/home"></head></html>` }, "https://x.ca/home": page(), "https://www.x.ca/": { status: 404 } }), "https://x.ca/");
  assert.ok(r.notes.includes("meta_refresh")); assert.equal(r.final_url, "https://x.ca/home");
});
test("D-08 JS-only redirect on near-empty body → needs_browser js_redirect", async () => {
  const r = await resolveCanonical(tx({ "https://x.ca/": { status: 200, body: "<html><body><script>window.location.href='https://x.ca/app'</script></body></html>" }, "https://www.x.ca/": { status: 404 } }), "https://x.ca/");
  assert.equal(r.needs_browser, true); assert.ok(r.needs_browser_reasons.includes("js_redirect"));
});
