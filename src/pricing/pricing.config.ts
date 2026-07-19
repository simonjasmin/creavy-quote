// Single source of truth for Creavy pricing (invariant #3). Repricing = edit here.
// All monetary values are integer CENTS, CAD (decision #20). Three price kinds only:
// flat | percent_modifier | human_quote (#20); e-commerce is human_quote (#21).
// The loader (loadPricingConfig.ts) hard-fails on any TODO(...) placeholder (#22).

export const rawPricingConfig = {
  currency: "CAD",

  care_plan: { key: "tranquillite", label_fr: "Tranquillité", monthly_cents: 5900 },

  // #28 bilingual tree-rung guards (config per #27.7; loader-validated).
  bilingual: { tree_lang_purity: 0.8, min_tree_pages: 3, min_size_ratio: 0.5 },

  tiers: {
    presence:   { label_fr: "Présence",         price_cents: 149000 },
    standard:   { label_fr: "Standard",         price_cents: 279000 },
    pro:        { label_fr: "Pro",              price_cents: 429000 },
    pro_custom: { label_fr: "Pro (sur mesure)", price_min_cents: 429000, price_max_cents: null },
  },

  // CHECKLIST add-on values, founder-supplied 2026-07-18. Dollars shown for readers;
  // stored as integer cents.
  addons: {
    extra_page:           { label_fr: "Page supplémentaire",                price: { kind: "flat", cents: 39000 } },   // $390
    copywriting_per_page: { label_fr: "Rédaction professionnelle (par page)", price: { kind: "flat", cents: 19000 } }, // $190/page
    logo_refresh:         { label_fr: "Rafraîchissement de logo",           price: { kind: "flat", cents: 49000 } },   // $490
    bilingual:            { label_fr: "Bilingue FR/EN (hors Pro)",          price: { kind: "flat", cents: 69000 } },   // $690
    booking:              { label_fr: "Réservation en ligne",               price: { kind: "flat", cents: 59000 } },   // $590
    ecommerce:            { label_fr: "Boutique / paiements en ligne",      price: { kind: "human_quote" } },          // #21 — sur mesure
    photo_sourcing:       { label_fr: "Recherche / retouche photo légère",  price: { kind: "flat", cents: 14000 } },   // $140
    seo_migration:        { label_fr: "Audit de migration SEO",             price: { kind: "flat", cents: 39000 } },   // $390
    rush_delivery:        { label_fr: "Livraison accélérée (< 2 semaines)", price: { kind: "percent_modifier", percent: 20, applies_to: "build_subtotal" } }, // +20% on build only
    extra_revision:       { label_fr: "Ronde de révision supplémentaire",   price: { kind: "flat", cents: 14000 } },   // $140
  },
} as const;
