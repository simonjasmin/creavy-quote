import { test } from "node:test";
import assert from "node:assert/strict";
import { PoliteScheduler } from "../src/crawl/scheduler.ts";
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
