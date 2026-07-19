import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PoliteScheduler } from "../src/crawl/scheduler.ts";
import { scan } from "../src/crawl/scan.ts";
import { FakeTransport, FakeClock, type Scenario } from "./helpers/replay.ts";

function scenarioFor(urls: string[], delayMs = 0): Scenario {
  return Object.fromEntries(urls.map((u) => [u, { status: 200, body: "ok", delayMs }]));
}

test("D-34 never > 2 in flight per host; spacing applied (fake clock)", async () => {
  const host = "https://slow-host.example";
  const urls = Array.from({ length: 12 }, (_, i) => `${host}/p${i}`);
  const clock = new FakeClock();
  const tx = new FakeTransport(scenarioFor(urls, 50), ".", clock);
  const sched = new PoliteScheduler(tx, clock, { spacingMs: 300, budgetMs: 60000 });
  const r = await sched.fetchAll(urls);
  assert.equal(r.results.length, 12, "all fetched within budget");
  assert.ok((tx.perHostMaxSeen["slow-host.example"] ?? 0) <= 2, `≤2 per host, saw ${tx.perHostMaxSeen["slow-host.example"]}`);
  assert.ok(r.elapsed > 0, "spacing advanced the clock");
});

test("D-34 per-host limit holds across multiple hosts", async () => {
  const urls = [
    ...Array.from({ length: 5 }, (_, i) => `https://a.example/p${i}`),
    ...Array.from({ length: 5 }, (_, i) => `https://b.example/p${i}`),
  ];
  const clock = new FakeClock();
  const tx = new FakeTransport(scenarioFor(urls, 20), ".", clock);
  await new PoliteScheduler(tx, clock, { spacingMs: 300, budgetMs: 60000 }).fetchAll(urls);
  assert.ok((tx.perHostMaxSeen["a.example"] ?? 0) <= 2);
  assert.ok((tx.perHostMaxSeen["b.example"] ?? 0) <= 2);
});

test("thread 6 / D-34 at composition: scan() holds ≤2 in-flight per host", async () => {
  const scenario = JSON.parse(readFileSync("fixtures/golden/mchenryplumbing/scenario.json", "utf8")) as Scenario;
  const clock = new FakeClock();
  const tx = new FakeTransport(scenario, ".", clock);
  await scan(tx, clock, "https://www.mchenryplumbing.ca/"); // multi-core site → scheduler-driven sample fetches
  for (const [host, max] of Object.entries(tx.perHostMaxSeen)) assert.ok(max <= 2, `${host} saw ${max} in flight`);
});

test("D-33 budget exhaustion → partial, counted-so-far", async () => {
  const host = "https://tarpit.example";
  const urls = Array.from({ length: 100 }, (_, i) => `${host}/p${i}`);
  const clock = new FakeClock();
  const tx = new FakeTransport(scenarioFor(urls, 3000), ".", clock); // each fetch burns 3s
  const r = await new PoliteScheduler(tx, clock, { spacingMs: 300, budgetMs: 25000 }).fetchAll(urls);
  assert.equal(r.partial, true, "budget exhausted → partial");
  assert.ok(r.results.length < 100, "did not fetch everything");
  assert.ok(r.elapsed <= 25000 + 6000, "stopped near the budget");
});
