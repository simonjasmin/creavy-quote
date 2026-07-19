import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../src/url/normalize.ts";
import { scan } from "../src/crawl/scan.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

const tx = (s: Scenario = {}) => new FakeTransport(s);

// --- N-21 amendment (#25 Part B) ---
test("N-21: private/reserved IP literals + localhost rejected; public kept", () => {
  for (const bad of ["http://10.0.0.1/", "http://127.0.0.1/", "http://192.168.1.1/", "http://169.254.169.254/", "http://172.16.0.5/", "localhost", "http://localhost/"])
    assert.equal(normalize(bad).ok, false, `${bad} must be rejected`);
  const pub = normalize("http://8.8.8.8/");
  assert.ok(pub.ok && pub.notes.includes("ip_literal"), "public IP literal allowed with note");
});

// --- D-35 private IP literal submitted → blocked at transport ---
test("D-35 private IP literal blocked before connect", async () => {
  assert.equal((await tx().fetch("http://10.0.0.1/")).error?.kind, "blocked");
  assert.equal((await tx().fetch("http://172.16.9.9/")).error?.kind, "blocked");
});

// --- D-36 localhost by name ---
test("D-36 localhost by name blocked", async () => {
  assert.equal((await tx().fetch("http://localhost/")).error?.kind, "blocked");
  assert.equal((await tx().fetch("http://foo.localhost/")).error?.kind, "blocked");
});

// --- D-37 public URL redirecting to loopback (per-hop revalidation) ---
test("D-37 redirect to loopback blocked per-hop", async () => {
  const r = await tx({ "https://good.example/": { status: 301, location: "http://127.0.0.1/admin" } }).fetch("https://good.example/");
  assert.equal(r.error?.kind, "blocked");
  assert.ok(r.chain.includes("https://good.example/"), "first hop happened, then the redirect was blocked");
});

// --- D-38 public URL redirecting to cloud metadata ---
test("D-38 redirect to 169.254.169.254 blocked", async () => {
  const r = await tx({ "https://good.example/": { status: 302, location: "http://169.254.169.254/latest/meta-data/" } }).fetch("https://good.example/");
  assert.equal(r.error?.kind, "blocked");
});

// --- D-39 redirect to non-http(s) scheme ---
test("D-39 redirect to file:// blocked", async () => {
  const r = await tx({ "https://good.example/": { status: 301, location: "file:///etc/passwd" } }).fetch("https://good.example/");
  assert.equal(r.error?.kind, "blocked");
});

// --- D-40 uniform failure: a blocked destination looks like any dead host ---
test("D-40 uniform failure — blocked indistinguishable from a dead host (no port-scan oracle)", async () => {
  const clock = new FakeClock();
  const blocked = await scan(tx(), clock, "http://10.0.0.5/");
  const dead = await scan(tx({ "https://dead.example/": { error: { kind: "other" } }, "https://www.dead.example/": { error: { kind: "other" } } }), clock, "dead.example");
  assert.deepEqual([...blocked.review_flags].sort(), [...dead.review_flags].sort(), "same review surface");
  assert.equal(blocked.detected_platform, dead.detected_platform);
  assert.ok(!blocked.review_flags.some((f) => /ssrf|blocked|private|internal|loopback|metadata/i.test(f)), "no SSRF leak in the output");
});
