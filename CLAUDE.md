# CLAUDE.md — creavy-quote

PHASE0-ARCHITECTURE.md is the spec. The Superpowers methodology drives all
work in this repo: brainstorm → spec → plan → TDD. Do not shortcut it.

## Invariants (survive every session, every refactor)
- **Claude proposes, code disposes.** The model returns a structured
  complexity assessment (validated JSON) — it NEVER emits the final price.
  The deterministic tier-mapping config module computes all prices.
- **Every quote persists**, including failures and abandons, with raw
  `crawl_facts` and `claude_assessment` — this is the repricing feedback
  loop and the conversion funnel. Never trim these columns.
- Prices live in ONE config module: Présence 1 490 · Standard 2 790 ·
  Pro 4 290 · Tranquillité 59/mois (CAD). Repricing = one-file change.
- The crawl is bounded and polite: page cap, per-fetch timeout, total
  budget, robots.txt respected, clear user-agent, public pages only.
- The API always returns something — worst case `failed` with a graceful
  book-a-call payload. No dead ends, no hangs.
- Rate limiting on POST /quote is not optional (public endpoint).
- v1 scope excludes Stripe, email workflows, auth, and the Playwright
  fallback (v1.1). Do not let them creep in.
