# Fingerprint adapter — TDD backlog (F-01…)

> Generated from the labelled corpus (`fixtures/sites/*/manifest.json`) by
> `spikes/genBacklog.mjs`. One case per fixture, table-driven like the crawl
> edge-case inventory. Each case: load the fixture's `root.html` + `root.headers.json`,
> run the adopted adapter, assert `platform` / `builder` / `confidence`.
> `confidence`: **high** where a deterministic signal exists; **low** for custom/static
> (no platform claim). Builder asserted only where ground truth is a known builder.

| ID | Fixture | Expect platform | Expect builder | Expect confidence |
|----|---------|-----------------|----------------|-------------------|
| F-01 | airclimatisationvs-ca | wordpress | — (any/none) | high |
| F-02 | amenagementdupaysage-com | wordpress | elementor | high |
| F-03 | amenagementpaysager-ca | custom | — | low (no claim) |
| F-04 | anniesimardphoto-com | wordpress | beaver | high |
| F-05 | arloca-com | shopify | — | high |
| F-06 | articho-ca | shopify | — | high |
| F-07 | artisansdupaysage-com | custom | — | low (no claim) |
| F-08 | beautemarc-com | wix | — | high |
| F-09 | boucherlortie-com | wordpress | — (any/none) | high |
| F-10 | clphotographe-com | wix | — | high |
| F-11 | coifferieinternationale-com | wordpress | — (any/none) | high |
| F-12 | coiffuredistinctive-ca | wordpress | elementor | high |
| F-13 | creationsdici-ca | custom | — | low (no claim) |
| F-14 | csmelectrique-com | wordpress | — (any/none) | high |
| F-15 | entreprisescardinal-com | custom | — | low (no claim) |
| F-16 | estcequontecoiffe-com | wix | — | high |
| F-17 | expair-ca | wordpress | — (any/none) | high |
| F-18 | itemconstruction-com | wordpress | elementor | high |
| F-19 | l2toiture-com | wordpress | — (any/none) | high |
| F-20 | labarberie-com | wordpress | — (any/none) | high |
| F-21 | lajoiecvac-com | custom | — | low (no claim) |
| F-22 | lasouche-ca | wordpress | — (any/none) | high |
| F-23 | lempreintecoop-com | shopify | — | high |
| F-24 | lespaceprive-square-site | square_online | — | high |
| F-25 | mchenryplumbing-ca | duda | — | high |
| F-26 | monshackauquebec-com | shopify | — | high |
| F-27 | mtlplomberie-ca | duda | — | high |
| F-28 | myriamtphotographe-com | squarespace | — | high |
| F-29 | paysagesgenest-com | custom | — | low (no claim) |
| F-30 | paysagistevilledequebec-ca | wordpress | elementor | high |
| F-31 | pierrehamelin-ca | wordpress | elementor | high |
| F-32 | plomberie-chauffage-montreal-ca | wordpress | elementor | high |
| F-33 | plomberiefdussault-ca | custom | — | low (no claim) |
| F-34 | plomberiemontreal-ca | custom | — | low (no claim) |
| F-35 | plombierdemontreal-com | wordpress | divi | high |
| F-36 | plombiermontreal-com | wordpress | — (any/none) | high |
| F-37 | protectoit-com | wix | — | high |
| F-38 | pureplomberie-com | wordpress | elementor | high |
| F-39 | quebecelectricien-ca | wordpress | wpbakery | high |
| F-40 | refrigerationeverest-com | wordpress | — (any/none) | high |
| F-41 | robertgingrasinc-com | custom | — | low (no claim) |
| F-42 | salonjumbojumbo-com | wordpress | — (any/none) | high |
| F-43 | signelocal-com | shopify | — | high |
| F-44 | toiture-quebec-ca | custom | — | low (no claim) |
| F-45 | toiturealpha-ca | wordpress | — (any/none) | high |
| F-46 | toituredelacapitale-com | custom | — | low (no claim) |
| F-47 | toitureqc-com | wordpress | — (any/none) | high |
| F-48 | toituresmarcelpouliot-com | custom | — | low (no claim) |
| F-49 | vincentlabonte-com | squarespace | — | high |
| F-50 | xavierpaysagiste-com | wordpress | — (any/none) | high |

**Calibration properties (assert across the whole table):**
- Zero platform claims on any `custom` fixture (the unforgivable failure).
- Zero *wrong* answers at `high` confidence.
- Every `high`-confidence claim carries ≥1 deterministic signal in `signals_matched`.
