# Assessment model benchmark (#32 Fork 1) — GATE input

> **Status: scripts ready, live run pending a key.** No `ANTHROPIC_API_KEY` is available in
> this environment, so — per the tour — the benchmark **scripts + this report** are committed
> and the run stops here. `spikes/benchmark-assess.mjs` **overwrites this file** with live
> side-by-side prose, latency, and tokens once a key is present. This pre-gate version states
> exactly what will run and shows the EN mirror few-shots for your nod.

## The decision (Fork 1)

Pick the assessment model. Build is **model-agnostic** — the id + params live in
[src/assess/config.ts](../src/assess/config.ts) (`assessConfig.model`, currently **`null`**).
Your pick becomes the config default; the recorder then bakes replay fixtures with it.

**Candidates:** `claude-sonnet-4-6`  vs  `claude-opus-4-8`.

The design note's steer (deferred to you): the job is small — read a few K tokens of site
text, characterize complexity, write one paragraph; it is **human-gated** and **streams live**,
so latency is UX. Recommendation was *default Sonnet for latency, decide from real output*.

## What the benchmark runs on

The assessable golden set (audited: only 1 real site qualifies; the 3 synthetics close the
shapes — see [SPEC §2.5 #28.1](../SPEC.md)). Both languages where the site is a bilingual mirror.

| site | kind | core | lang(s) | pages | ~words of content |
|---|---|--:|---|--:|--:|
| toituresmarcelpouliot | **real** | 4 | fr | 4 | ~773 |
| syn-couvreur-dated | synthetic (findings) | 4 | fr | 4 | ~198 |
| syn-plomberie-bilingue | synthetic (bilingual) | 3 | fr + en | 3 | ~88 |
| syn-electricien-sain | synthetic (healthy) | 5 | fr | 5 | ~193 |

**5 case-languages × 2 models = 10 live calls.** Per call the benchmark captures: the prose
(prospect-facing), `complexity` / `confidence` / `flagged_for_review`, `complexity_factors`,
**latency (ms)**, and **output tokens**. Output: a summary table + side-by-side prose per case.

The three synthetics are the calibration spread the voice must prove itself on:
- **findings** (`syn-couvreur-dated`) — a 2009 copyright + IE/Flash mention in the footer text;
  the severity should rise to name it (dated_design) with the warm pivot.
- **healthy** (`syn-electricien-sain`) — current, clean, structured; the voice must **not
  manufacture alarm** (the calibration case).
- **bilingual** (`syn-plomberie-bilingue`) — fr+en mirror; `multilingual_content`, and the EN
  run exercises the English voice.

## How to run

```
ANTHROPIC_API_KEY=sk-... node spikes/benchmark-assess.mjs      # writes the live version of this file
```

After you pick, set `assessConfig.model`, then:

```
ANTHROPIC_API_KEY=sk-... node spikes/record-assess.mjs <model-id>   # bakes fixtures/assess/<slug>.<lang>.json
node --test                                                          # replays them offline, deterministic
```

## EN mirror few-shots — for your nod (Fork 3)

The two FR few-shots are ratified verbatim (SPEC §2.10). Their EN mirrors (shipped when the
form is EN) — same severity ladder, same warm pivot, same close:

> **Findings (EN):** "Your site has four pages on WordPress. The security certificate has
> expired: visitors see a warning before they even land, and on mobile many close the tab right
> there. The good news: your content is reusable. We rebuild the foundation — same structure,
> redone clean, fast and secure. The estimate is just below."

> **Healthy (EN):** "Your site is in good shape: five well-structured pages, a valid
> certificate, clear content. A rebuild isn't urgent. If you'd like to modernize the look or add
> online booking, here's what that would look like — the estimate is just below."

## 🚦 Gate

Reply with the model (`claude-sonnet-4-6` or `claude-opus-4-8`) — and a nod (or edits) on the
EN mirrors. Then: set the config default, record replay fixtures, finalize the suite, push.
