# Phase 2a — local smoke transcript

> Produced by `node spikes/smoke-2a.mjs` — a **real HTTP server on localhost**, exercised
> over the wire. No Railway, no Postgres, no network: MemoryStore + a golden-fixture
> transport stand in so the five ratified behaviours run deterministically. The **staging
> URL + a live-network run are the founder's deploy step** (this environment has no Railway
> CLI/token and no DATABASE_URL — see the gate report).

```
# Phase 2a — local smoke transcript (http://127.0.0.1:PORT, MemoryStore, golden-fixture transport)

## 1. Scanned quote → completion via poll (ICP golden: toituresmarcelpouliot.com)
POST /quote → 200 {"quote_id":"qt_…","status":"pending"}
GET /quote/qt_… → {"quote_id":"qt_…","status":"completed","indicative":true,"basis":"scanned",
  "register":"flat","review_required":false,"result":{"bundle":{"tier":"standard","addons":[],
  "modifiers":[]},"indicative_total":279000,"currency":"CAD","suggested_addons":[],
  "care_plan_monthly":5900,"reasons":["cheapest_bundle"],"core_pages":4,
  "detected_platform":"unknown","confidence":"low",
  "analysis_details":[{"item":"pages","value":4},{"item":"language","value":"fr"}]}}
GET /quote/:id/events → 9 public lines, e.g.
  [{"seq":0,"type":"scan_started","text":"Démarrage de l'analyse…"},
   {"seq":1,"type":"url_normalized","text":"Analyse de toituresmarcelpouliot.com…"},
   {"seq":3,"type":"page_fetched","text":"Lecture de vos pages… 1 de ~4"}]

## 2. No-site declared quote (answers only: booking + bilingual)
POST /quote → 200 {"quote_id":"qt_…","status":"completed","indicative":true,"basis":"declared",
  "register":"flat","review_required":false,"result":{"bundle":{"tier":"standard",
  "addons":["bilingual","booking"],"modifiers":[]},"indicative_total":407000,"currency":"CAD",
  "suggested_addons":[],"care_plan_monthly":5900,
  "reasons":["cheapest_bundle","bilingual_addon","declared_basis"]}}

## 3. Rate-limit burst (RATE_LIMIT_MAX=3; 2 prior POSTs already counted)
POST /quote #1 → 200
POST /quote #2 → 429 (Retry-After: 60s) {"error":"rate_limited"}
POST /quote #3 → 429 (Retry-After: 60s) {"error":"rate_limited"}
POST /quote #4 → 429 (Retry-After: 60s) {"error":"rate_limited"}

## 4. CORS (#33)
GET /health  Origin https://creavy.netlify.app                       → ACAO: https://creavy.netlify.app
GET /health  Origin https://deploy-preview-12--creavy.netlify.app    → ACAO: https://deploy-preview-12--creavy.netlify.app
GET /health  Origin https://evil.com                                 → ACAO: (none — blocked)

## 5. Health
GET /health → 200 {"status":"ok","env":"development"}
```

**Two correct-not-bug notes on §1:** the golden `toituresmarcelpouliot` is a *custom* (undetected)
platform, so it is **not named** at low confidence (#23) → `detected_platform:"unknown"`, and it
is an **http** site, so `https` is absent from `analysis_details` (true-only, #31). Both are the
intended behaviours, visible here on a real site.
