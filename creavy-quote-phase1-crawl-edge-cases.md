# creavy-quote — Phase 1 crawl edge-case inventory

**Scope:** table-driven test cases for the crawl-side modules of the Phase 1 TDD core — URL normalizer, robots policy, sitemap discovery, crawl bounder. The fingerprint adapter is excluded (the spike owns it); assessment schema and pricing config are separate backlogs.

**How to read this:**
- Each row = one test. IDs are stable — reference them in commits and reviews ("B-09 red").
- Rows tagged **[spec?]** propose behavior SPEC may not decide yet. Per the methodology, each needs a written decision *before* its test is authored. They are collected in §7 as one decision batch.
- Guiding bias throughout: the crawler produces a **triage-grade** count, not a perfect mirror. When ambiguous, emit a review flag instead of a confident wrong number.

---

## 1. Layer split (keeps Table A pure)

`normalize(url)` is pure string → string: no network, no fixtures, one test loop over Table A. Canonical-origin resolution — scheme upgrade, www/apex unification, cross-domain root redirects — requires the network and lives in Table D (D-01…D-04). Keep them separate functions: it makes the normalizer trivially table-testable, and every other module dedupes through one shared identity function.

---

## 2. Suggested bounder output shape

Not a bare integer:

```
{
  canonical_origin: "https://www.example.ca",
  core_pages: 4,            // distinct HTML pages, deduped, archives excluded
  blog_posts: 12,           // counted separately — 12 posts ≠ 12 layouts
  excluded: { archives: 9, media: 3, soft_404: 1, external: 22 },
  languages: ["fr", "en"],
  bilingual_mirror: true,   // fr/en trees deduped into core_pages
  needs_browser: false,     // fast-path verdict; reasons[] when true
  review_flags: [],         // "robots_blocked", "stale_sitemap", "tls_invalid", ...
  partial: false            // budget exhausted before completion
}
```

Rationale: tier mapping consumes `core_pages` + components. Blog volume and bilingualism are **pricing signals, not page inflation** — a plumber with 12 posts is not a 16-layout build, and a Québec site with `/fr/` + `/en/` mirrors is one bilingual site, not double the pages. **[spec?]** if SPEC currently types the result as a single count.

---

## 3. Proposed caps (defaults — the whole table is **[spec?]**)

| Cap | Default | Note |
|---|---|---|
| Core pages counted precisely | 30 | Beyond → report `"30+"`, stop, review flag (out-of-ICP short-circuit) |
| Crawl depth from root | 3 | |
| Fetches per fast-path scan | 60 | |
| Redirect hops per URL | 5 | Applies to robots.txt fetch too |
| Per-request timeout | 8 s | One retry, connect errors only |
| Total fast-path budget | 25 s | On exhaustion → `partial: true`, never hang the quote flow |
| HTML bytes read per page | 2 MB | Parse the truncated prefix |
| robots.txt parse cap | 500 KB | Matches Google's own cap |
| Sitemap index recursion depth | 2 | |
| Child sitemaps fetched | 5 | |
| Politeness | 2 concurrent, ~300 ms spacing per host | |

Trades sites are tiny. Caps exist so weird sites fail *fast* — hitting one is itself a signal (out-of-ICP, trap, or broken), not an invitation to crawl harder.

---

## 4. Table A — URL normalizer (pure function)

| ID | Input | Expected | Why |
|---|---|---|---|
| N-01 | `example.com` | `https://example.com/` | Form input rarely has a scheme; default https |
| N-02 | `  example.com  ` | Trimmed, then as N-01 | Copy-paste whitespace |
| N-03 | `EXAMPLE.COM` | Host lowercased | Hosts are case-insensitive |
| N-04 | `example.com/Services/Plumbing` | Host lowercased, path case preserved | Paths are case-sensitive |
| N-05 | `https://example.com:443/`, `http://example.com:80/` | Default ports stripped; `:8080` kept + `unusual_port` note | |
| N-06 | `/services/` vs `/services` | Same identity key | Servers 301 one to the other; dedupe at identity level |
| N-07 | `/services#pricing` | Fragment stripped | Same document |
| N-08 | `/#services` | `/` | Anchor nav never creates pages — the one-pager (Présence) signature |
| N-09 | `?utm_source=x&utm_medium=y&fbclid=z&gclid=q` | Tracking params stripped (`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_cid`, `mc_eid`, `ref`); survivors sorted for identity | Same page, infinite URL variants |
| N-10 | `/?p=123`, `/?page_id=7` | Query **kept** | WordPress plain permalinks — the query *is* the page. Never blanket-strip queries |
| N-11 | `/?p=123&utm_source=fb` | `/?p=123` | N-09 + N-10 compose |
| N-12 | `/r%c3%a9novation` vs `/rénovation` | Same identity; hex uppercased (`%C3%A9`); reserved chars (`%2F`) never decoded | French paths are the norm in this ICP |
| N-13 | `plombier-montréal.ca` | Punycode (`xn--…`) for fetching, display form retained | Accented .ca domains exist in Québec |
| N-14 | `//services///plans` | `/services/plans` | Duplicate slashes collapse |
| N-15 | `/a/./b/../c` | `/a/c` | Dot-segment resolution |
| N-16 | `/index.html`, `/index.htm`, `/index.php`, `/services/index.html` | → `/`, `/services/` (fixed small list only) | Old handmade sites; anything beyond the list untouched |
| N-17 | `//example.com/x` | `https://example.com/x` | Protocol-relative input |
| N-18 | `https://user:pass@example.com` | Userinfo stripped + `suspicious_input` note **[spec?]** | Phishing-pattern input in a public form |
| N-19 | `mailto:`, `ftp://`, `file://` | Typed rejection error | Only http(s) enters the pipeline |
| N-20 | `https:/example.com`, `https//example.com` | Repair to `https://…` **[spec?]** | Cheap goodwill in a lead form vs strictness — decide once |
| N-21 | `http://192.0.2.10` | Valid; `ip_literal` note | Rare; "no domain" is itself an assessment signal |
| N-22 | `facebook.com/plomberie-x`, `instagram.com/...`, `linktr.ee/...`, `business.site/...`, `pagesjaunes.ca/...` | Classified `no_owned_site` → **skip crawl**, route greenfield path | Huge for this ICP: "their website" is a Facebook page. Don't crawl the platform |
| N-23 | `remax-quebec.com/courtier/...`, `centris.ca/...` | Classified `platform_profile` → human review | Realtor "site" is a profile on someone else's domain |
| N-24 | `HTTP://WWW.EXAMPLE.CA:80//Services/../index.html?utm_source=fb#devis` | `http://www.example.ca/` (scheme/host finalized later by D-01…D-03) | The full gauntlet in one case |
| N-25 | `https://example.com?x=1` | `https://example.com/?x=1` | Empty path defaults to `/` |
| N-26 | `HTTPS://example.com` | Scheme lowercased | |
| N-27 | `example .com` | Typed rejection error | Don't guess through interior whitespace |
| N-28 | URL > 2,000 chars | Rejected + note | Garbage in the form |
| N-29 | `example.com.` | Trailing dot stripped | FQDN form |
| N-30 | *(property test)* | `normalize(normalize(x)) == normalize(x)` for every row above | Idempotence guards the whole table |

---

## 5. Table B — robots policy

| ID | Scenario | Expected | Why |
|---|---|---|---|
| R-01 | `/robots.txt` → 404 | Allow all; `robots_absent` note | Absence is the ICP norm |
| R-02 | `/robots.txt` → 401/403 | Allow all | RFC 9309: 4xx = no restrictions |
| R-03 | `/robots.txt` → 500/503 | Treat as full disallow for *expansion*; still fetch the user-submitted URL itself; review flag **[spec?]** | RFC treats server error as disallow; a submitted URL is a direct request, not a crawl |
| R-04 | robots.txt redirects (http→https, apex→www) | Follow ≤ 5 hops, apply result | Standard practice |
| R-05 | Redirect loop on robots.txt | Treat as unavailable → R-03 behavior | |
| R-06 | 200 but body is an HTML error page | Detect markup → treat as absent (R-01) | Cheap-host classic: everything returns 200 |
| R-07 | Group for our UA token present alongside `*` | Specific group wins; UA string lives in config **[spec?]** | Name the bot once, in one place |
| R-08 | `USER-AGENT:` / `disallow:` mixed case | Parses fine | Directives are case-insensitive |
| R-09 | `User-agent: *` / `Disallow: /wp-admin/` / `Allow: /wp-admin/admin-ajax.php` | `/wp-admin/` blocked, `admin-ajax.php` allowed | The canonical WordPress default — your most common real fixture |
| R-10 | `Disallow: /` (full block) | No auto-crawl. Homepage-only assessment from the submitted URL + `robots_blocked` review flag **[spec?]** | Policy call: a human handed us the link (direct fetch ≠ crawl), but expansion respects robots. Write it down |
| R-11 | `Disallow: /*?s=`, `Disallow: /*.pdf$` | Wildcard `*` and anchor `$` matching | Common in the wild |
| R-12 | Allow vs Disallow both match | Longest pattern wins; exact tie → Allow | Google-compatible precedence |
| R-13 | `Crawl-delay: 10` | Honor up to a cap (10 s), else review flag **[spec?]** | Non-standard directive; decide once |
| R-14 | Multiple `Sitemap:` lines, incl. cross-host | Collect all; cross-host allowed by protocol, locs still scope-filtered later | |
| R-15 | `Sitemap: /sitemap.xml` (relative — invalid but common) | Resolve against origin + note | Tolerance beats purity here |
| R-16 | BOM, CRLF, comments, blank lines inside groups | Tolerant parse | Hand-edited files |
| R-17 | Unknown directives (`Noindex:`, `Host:`) | Ignored without error | |
| R-18 | robots.txt > 500 KB | Parse first 500 KB, `truncated` note | |
| R-19 | Non-UTF-8 bytes | Lossy-decode, keep parsing | |
| R-20 | Served as `application/octet-stream` but valid text | Parse anyway | Sniff content, don't trust headers |

---

## 6. Table C — sitemap discovery & parsing

| ID | Scenario | Expected | Why |
|---|---|---|---|
| S-01 | Discovery order | robots `Sitemap:` lines first, then `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`; stop at first parseable | Covers Yoast, WP core (5.5+), Wix, Squarespace defaults |
| S-02 | Nothing found anywhere | Link-crawl fallback (Table D); `sitemap_absent` note | |
| S-03 | Plain `<urlset>` with N locs | N candidates → normalizer + scope filter | Happy path |
| S-04 | Sitemap index → child sitemaps | Recurse; depth ≤ 2, children ≤ 5; beyond → partial + review flag | |
| S-05 | Index with 40 children | Out-of-ICP short-circuit: report `"30+"`, stop fetching | This is not a Creavy job; don't spend budget proving it precisely |
| S-06 | robots-listed sitemap 404s | Fall through to well-known paths, then crawl; `stale_robots_sitemap` note | Abandoned-site classic |
| S-07 | Sitemap URL returns 200 HTML (error/soft-404 page) | Unparseable → next candidate | |
| S-08 | `.xml.gz` body and/or `Content-Encoding: gzip`; also gzip served with no header | Decompress; sniff magic bytes | |
| S-09 | Malformed XML (unclosed tag mid-file) | Tolerant `<loc>` extraction; zero locs → treat unparseable | Real sitemaps are often broken |
| S-10 | Missing/wrong xmlns | Parse anyway | Namespace-lenient |
| S-11 | `<loc>` with whitespace/newlines/CDATA | Trim/unwrap | |
| S-12 | `&amp;` entities in loc | Decoded once | |
| S-13 | Relative loc (invalid but seen) | Resolve against the sitemap's URL + note | |
| S-14 | Locs on wrong host variant (www/apex, http/https) | Through normalizer + canonical-host map → dedupe | Integration case with A + D |
| S-15 | Majority of locs off-domain | Distrust sitemap; review flag; crawl fallback | Platform sitemap or misconfig |
| S-16 | Duplicate locs, fragments, tracking params | Dedupe via identity function | |
| S-17 | WP core `wp-sitemap.xml`: users, taxonomies, post archives included | Classify: pages → `core`; posts → `blog_posts`; users/taxonomies/archives → `excluded.archives` | Raw loc count wildly overstates a WP site |
| S-18 | Yoast layout: `page-sitemap.xml`, `post-sitemap.xml`, `category-sitemap.xml` | Same classification by child sitemap type | |
| S-19 | Media/attachment locs (`/wp-content/uploads/…`, `?attachment_id=`) | `excluded.media` | |
| S-20 | Stale sitemap: sample-verify min(core, 10) locs; > 30 % non-200 | Distrust sitemap → crawl fallback + `stale_sitemap` flag; thresholds **[spec?]** | Sitemap-only counting is cheap but lies on abandoned sites — decide the trust rule |
| S-21 | Garbage `lastmod` (`0000-00-00`, "yesterday") | Ignore field, never crash | |
| S-22 | fr + en mirrors listed (`/fr/x` + `/en/x`, or hreflang alternates) | Language-pair dedupe → `bilingual_mirror: true`, both languages recorded, one core page per pair **[spec?]** | **Pricing-critical.** Bilingual is a tier feature ($690 add-on / Pro-included), not 2× pages |
| S-23 | Huge sitemap (50k locs, 10 MB) | Read cap + `"30+"` short-circuit | |
| S-24 | XML entity bomb / deep nesting | Hardened parser, entity expansion off | Public-facing input; cheap to require |

---

## 7. Table D — crawl bounder: canonicalization, counting, escalation

### D1. Canonical-origin resolution (the network half of normalization)

| ID | Scenario | Expected | Why |
|---|---|---|---|
| D-01 | `http://` input → 301 → https | Canonical https; `scheme_upgraded` recorded | |
| D-02 | apex → www 301 (or reverse) | Canonical host recorded; both forms dedupe everywhere downstream | |
| D-03 | apex *and* www both serve 200, no redirect | Pick deterministically (https, then the form the homepage's own internal links use); `host_ambiguous` flag **[spec?]** | Misconfigured DNS/vhost — common on cheap hosting |
| D-04 | Root redirects cross-domain (`example.com` → `example.ca`) | Re-anchor once at root level; `domain_moved` recorded; a *second* cross-domain hop → stop + flag | Post-rebrand reality; also catches redirect-to-parked |
| D-05 | Chain `/` → `/home` → `/fr/accueil` (≤ 5 hops) | One page, identity = final URL | |
| D-06 | Redirect loop | Break, flag, count 0 for that URL | |
| D-07 | Meta-refresh on homepage (`<meta http-equiv="refresh">`) | Treated as a redirect | Old handmade sites |
| D-08 | JS-only redirect (`window.location` in a near-empty body) | Fast path can't follow → `needs_browser: js_redirect` | First escalation trigger |

### D2. Counting & classification

| ID | Scenario | Expected | Why |
|---|---|---|---|
| D-09 | One-pager, nav is all `#anchors` | `core_pages: 1` | The Présence-tier signature |
| D-10 | Nav: 4 real pages + `mailto:` + `tel:` | 4 pages; tel/mailto recorded as **contact signals**, never pages | Click-to-call presence feeds the assessment |
| D-11 | Relative links, `../`, protocol-relative `//cdn…` | Resolved via normalizer; off-origin → `excluded.external` | |
| D-12 | `<base href>` present | Links resolve against base | Old handmade sites again |
| D-13 | Unencoded space in href (`/nos services.html`) | Encode-and-fetch once; on failure drop + `broken_link` note | Broken links are a sales signal, not just noise |
| D-14 | `rel=canonical` same-host divergence | Adopt canonical for identity/dedupe | Kills `?ref=nav` duplicates |
| D-15 | `rel=canonical` cross-host | `platform_canonical` flag → review | Site is a mirror/reskin of something else |
| D-16 | `/fr/` + `/en/` mirrored trees found via crawl (no sitemap) | Pair-dedupe as S-22; hreflang when present, path-mirror heuristic otherwise **[spec?]** | Same pricing-critical rule, crawl side |
| D-17 | `/blog/page/2`, `/category/x`, `/author/y`, `/2024/05/` | `excluded.archives`; never expanded past cap | Archive sprawl isn't layout work |
| D-18 | Soft 404: HTTP 200, title/body says "Page non trouvée" / "Page not found" / "404" | `excluded.soft_404` | FR **and** EN markers — cheap-host Québec reality |
| D-19 | Traps: `?month=`, `PHPSESSID`, > 2 query params | Don't expand; identity via normalizer; `trap` note | Calendars and session IDs are infinite |
| D-20 | Subdomain links (`blog.example.ca` from `example.ca`) | Not core; recorded `related_property` **[spec?]** | www↔apex unify; every other subdomain is out of count |
| D-21 | Frontier non-empty when a cap hits | `partial: true` + whatever was counted | Never a hang, never a silent undercount |

### D3. Escalation to Playwright (`needs_browser` reasons)

| ID | Scenario | Expected | Why |
|---|---|---|---|
| D-22 | 200, HTML < 2 KB, script bundles present, empty `#root`/`#app` | Escalate: `spa_shell` | |
| D-23 | Zero `<a href>` found on homepage, scripts present, no sitemap | Escalate: `no_links_found` | onclick-only nav |
| D-24 | Cloudflare/anti-bot challenge markers | **Don't fight it.** One polite attempt max, then `anti_bot` review flag **[spec?]** | Escalation ≠ evasion; a human closes this lead |
| D-25 | Current Wix / Squarespace / GoDaddy-builder fixtures | Assert **no** escalation | These serve server-rendered HTML. Guard the ~90 % fast-path economics — if these fixtures escalate, the triggers are too jumpy |

### D4. Transport & content edges

| ID | Scenario | Expected | Why |
|---|---|---|---|
| D-26 | Expired/invalid TLS | Record `tls_invalid`; retry unverified for assessment only **[spec?]** | ICP classic — and a sales signal ("your site warns visitors") |
| D-27 | windows-1252 / iso-8859-1 French page | Charset from header → meta → sniff; "Électricité" survives intact | Old Québec sites; mojibake poisons fingerprint + assessment |
| D-28 | Homepage content-type is PDF or image | `core_pages: 0`, `no_html` flag → greenfield-ish path | Some trades "sites" are literally a PDF |
| D-29 | Parked-domain lander (registrar markers, "domain for sale") | `parked` flag → greenfield path, skip crawl | |
| D-30 | Maintenance / coming-soon plugin page | `under_construction` flag → review | |
| D-31 | 5 MB HTML | Read 2 MB cap, parse partial, `truncated_html` note | |
| D-32 | Timeout / DNS NXDOMAIN / connection refused / TLS handshake failure | Typed errors, distinguished: NXDOMAIN → **no site = greenfield lead**; refused/timeout → `slow_host` or down → review | "No site" and "site down" are different funnels |
| D-33 | Total budget exhausted mid-crawl | Return `partial: true` + counted-so-far + review flag | The quote flow never blocks on a bad host |
| D-34 | *(property test)* Politeness invariant | Never > 2 in flight per host, spacing respected — fake-clock test on the scheduler | Keeps the bot a good citizen by construction |

---

## 8. Fixtures

- Table A needs none — pure functions.
- Tables B–D replay saved responses: `fixtures/<case-id>/` holding `{url, status, headers, body}` per request plus an `expected.json`. Loader replays offline; tests never touch the network.
- Harvest 15–20 real ICP sites (plumber/HVAC/realtor across WordPress, Wix, Squarespace, GoDaddy) into fixtures **during the fingerprint spike** — one corpus serves both modules.
- Strip `Set-Cookie` headers from anything committed.

---

## 9. The decision batch — resolve before authoring the tagged tests

Every **[spec?]** above, gathered so Claude Code never invents policy mid-TDD. One short session, write each decision into SPEC, then the tables are mechanical:

1. Bounder output shape — structured object vs single count (§2)
2. All caps table defaults (§3)
3. Typo repair vs strict rejection in the form (N-20); userinfo handling (N-18)
4. robots.txt 5xx policy (R-03) and full-`Disallow: /` policy (R-10)
5. Bot UA token (R-07); crawl-delay cap (R-13)
6. Stale-sitemap trust thresholds — sample size + failure % (S-20)
7. Bilingual pair-dedupe rule — hreflang + path-mirror heuristic (S-22 / D-16)
8. Host-ambiguity tiebreak (D-03); subdomain scope (D-20)
9. Anti-bot single-attempt rule (D-24); TLS-invalid unverified retry (D-26)

Suggested order of build once decisions land: A (pure, fast wins) → B → C → D1/D2 → D3/D4.
