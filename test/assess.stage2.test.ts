import { test } from "node:test";
import assert from "node:assert/strict";
import { startAssessment, projectAssessment, type AssessmentDeps } from "../src/service/assessment/service.ts";
import { validateAssessBody } from "../src/service/assessment/validate.ts";
import { MemoryStore } from "../src/service/store/memoryStore.ts";
import { loadServiceConfig } from "../src/service/config.ts";
import { pricingConfig } from "../src/pricing/index.ts";
import { projectStream } from "../src/crawl/eventProjection.ts";
import { scriptedModel, transcript, validMeta, fakeScan } from "./helpers/assess.ts";
import { FakeClock } from "./helpers/replay.ts";

const T0 = 1_700_000_000_000;
const PROSE = "Votre site a quatre pages sur WordPress. Le contenu est clair. L'estimation est juste en dessous.";
const cfg = (over: Record<string, string> = {}) => loadServiceConfig({ ALLOWED_ORIGIN: "https://creavy.netlify.app", NODE_ENV: "development", ...over });
const svcDeps = (store: MemoryStore, model: any, clock: FakeClock, over: Record<string, string> = {}): AssessmentDeps =>
  ({ store, model, modelId: "claude-opus-4-8", clock, serviceConfig: cfg(over), pricing: pricingConfig, lang: "fr" });

async function seedJob(store: MemoryStore, clock: FakeClock, scanOver = {}, status: "completed" | "pending" = "completed") {
  const scan = fakeScan(scanOver as any);
  const { page_content, ...facts } = scan;
  const job = await store.createJob({ id: "qt_seed", no_site: false, url: "https://roof.example/", normalized_url: "https://roof.example/", answers_hash: null, answers: { pages: "3_4", component: "none", languages: "fr", has_brand_assets: true }, persona: null, fresh_scan: true }, clock.now());
  await store.updateJob(job.id, { status, crawl_facts: facts, page_content, mapper_output: { suggested_addons: [{ id: "logo_refresh", amount: 49000 }] }, response: { basis: "scanned", register: "flat", result: {} } }, clock.now());
  return job.id;
}

// ---- idempotency: N POSTs → exactly ONE model call (#32 A7) ----
test("ST2-01 five POSTs → exactly one model invocation", async () => {
  const store = new MemoryStore(), clock = new FakeClock(T0);
  const qid = await seedJob(store, clock);
  const calls = { n: 0 };
  const model = scriptedModel(transcript(PROSE, validMeta()), { calls });
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) { const r = await startAssessment(svcDeps(store, model, clock), qid, "ready"); if ("assessment" in r) ids.add(r.assessment.id); await (r as any).done; }
  assert.equal(calls.n, 1, "one model call across five POSTs");
  assert.equal(ids.size, 1, "same assessment id returned every time");
});

// ---- preconditions (#32 A6) — no model call, page unchanged ----
test("ST2-02 preconditions → typed refusals, no model call", async () => {
  const clock = new FakeClock(T0);
  const calls = { n: 0 };
  const model = scriptedModel(transcript(PROSE, validMeta()), { calls });
  // not found
  assert.equal((await startAssessment(svcDeps(new MemoryStore(), model, clock), "qt_nope", "ready")).kind, "not_found");
  // not completed
  { const s = new MemoryStore(); const q = await seedJob(s, clock, {}, "pending"); const r = await startAssessment(svcDeps(s, model, clock), q, "ready"); assert.equal(r.kind, "precondition"); assert.equal((r as any).reason, "quote_not_completed"); }
  // not assessable (30+)
  { const s = new MemoryStore(); const q = await seedJob(s, clock, { core_pages: "30+" }); const r = await startAssessment(svcDeps(s, model, clock), q, "ready"); assert.equal(r.kind, "precondition"); assert.equal((r as any).reason, "not_assessable"); }
  assert.equal(calls.n, 0, "no model call on any precondition failure");
});

// ---- assessment daily ceiling ----
test("ST2-03 assessment ceiling exceeded → budget_exceeded, no model call", async () => {
  const store = new MemoryStore(), clock = new FakeClock(T0);
  const qid = await seedJob(store, clock);
  const calls = { n: 0 };
  const r = await startAssessment(svcDeps(store, scriptedModel("x", { calls }), clock, { DAILY_ASSESSMENT_CEILING: "0" }), qid, "ready");
  assert.equal(r.kind, "ceiling");
  assert.equal(calls.n, 0);
});

// ---- PII refusal by construction (T4) ----
test("ST2-04 body validation refuses PII + enforces the enum", () => {
  assert.equal(validateAssessBody({ content_readiness: "ready" }).ok, true);
  assert.equal(validateAssessBody({ content_readiness: "partial", company_website: "" }).ok, true); // honeypot allowed
  assert.equal(validateAssessBody({ content_readiness: "ready", email: "a@b.com" }).ok, false); // unknown key
  assert.equal((validateAssessBody({ content_readiness: "ready", courriel: "x@y.ca" }) as any).error.detail.includes("unexpected"), true);
  assert.equal((validateAssessBody({ content_readiness: "note: me@x.com please" }) as any).error.error, "pii_refused"); // email-shaped value
  assert.equal((validateAssessBody({ content_readiness: "maybe" }) as any).error.error, "invalid_request"); // out of enum
});

// ---- public projection: internals NEVER ship ----
test("ST2-05 GET-projection carries prose + suggestions, never internals", async () => {
  const store = new MemoryStore(), clock = new FakeClock(T0);
  const qid = await seedJob(store, clock);
  const model = scriptedModel(transcript(PROSE, validMeta({ review_note: "SECRET note", complexity_factors: ["dated_design"], confidence: "high", flagged_for_review: true })));
  const r = await startAssessment(svcDeps(store, model, clock), qid, "partial");
  await (r as any).done;
  const a = (await store.getAssessmentByQuote(qid))!;
  const pub = projectAssessment(a);
  assert.equal(a.status, "completed");
  assert.ok((pub.prose_chunks as string[]).join("").includes("L'estimation est juste en dessous"));
  for (const k of ["complexity", "complexity_factors", "review_note", "confidence", "flagged_for_review"]) assert.ok(!(k in pub), `internal leak: ${k}`);
  // content_readiness=partial → copywriting suggestion merged in
  assert.ok((pub.suggested_addons as any[]).some((s) => s.id === "copywriting_per_page"));
});

// ---- streaming on the #24 spine: prose ships, internals don't ----
test("ST2-06 assessment_* stream on the quote spine; internals absent from projection", async () => {
  const store = new MemoryStore(), clock = new FakeClock(T0);
  const qid = await seedJob(store, clock);
  const model = scriptedModel(transcript(PROSE, validMeta({ review_note: "SECRET" })), { chunkSize: 9 });
  const r = await startAssessment(svcDeps(store, model, clock), qid, "ready");
  await (r as any).done;
  const events = await store.getEventsSince(qid, -1);
  const types = events.map((e) => e.type);
  assert.ok(types[0] === "assessment_started" && types.at(-1) === "assessment_complete");
  const stream = projectStream(events, "fr");
  const prose = stream.filter((s) => s.type === "assessment_chunk").map((s) => s.text).join("");
  assert.equal(prose, PROSE, "chunks reconstruct the prose");
  assert.ok(!stream.map((s) => s.text).join("").includes("SECRET"), "no internal leak in the projected stream");
});

// ---- failure = terminal unavailable; stage 1½ untouched (T5) ----
test("ST2-07 every failure mode → terminal unavailable, stage-1 response unchanged", async () => {
  for (const [name, model] of [
    ["throws", scriptedModel("", { fail: new Error("529") })],
    ["invalid", scriptedModel("no delimiter here")],
    ["no-model", null as any],
  ] as const) {
    const store = new MemoryStore(), clock = new FakeClock(T0);
    const qid = await seedJob(store, clock);
    const before = JSON.stringify((await store.getJob(qid))!.response);
    const r = await startAssessment(svcDeps(store, model, clock), qid, "ready");
    await (r as any).done;
    const a = (await store.getAssessmentByQuote(qid))!;
    assert.equal(a.status, "unavailable", `${name} → unavailable`);
    assert.equal(JSON.stringify((await store.getJob(qid))!.response), before, `${name}: stage-1 response unchanged (T5)`);
  }
});
