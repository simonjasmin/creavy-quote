// Single source of truth for Creavy pricing (invariant #3). Repricing = edit here.
// All monetary values are integer CENTS, CAD (decision #20). Three price kinds only:
// flat | percent_modifier | human_quote (#20); e-commerce is human_quote (#21).
// The loader (loadPricingConfig.ts) hard-fails on any TODO(...) placeholder (#22).

export const rawPricingConfig = {
  currency: "CAD",

  care_plan: { key: "tranquillite", label_fr: "Tranquillité", monthly_cents: 5900 },

  // #37 payment-terms DISPLAY only — installments of the same fixed total (no premium, no
  // interest, no new price kind). The final versement absorbs rounding. Config per #27.7/#22.
  payment_terms_months: 12,

  // #28 bilingual tree-rung guards (config per #27.7; loader-validated).
  bilingual: { tree_lang_purity: 0.8, min_tree_pages: 3, min_size_ratio: 0.5 },

  // #27 tier-mapping constants (config per #27.7; loader-validated).
  tiermap: {
    review_pages: 7,          // ≥ this → review_required, no auto-bundle (27.2)
    size_band_max: 12,        // #35: clean 7..this core → estimation band (range); > this → pure review
    blog_seo_threshold: 5,    // blog_posts ≥ this → SEO migration auto-included (27.5)
    extra_page_cap: 3,        // max extra-page add-ons stacked before it's a review shape
    presence_max_pages: 2,
    standard_base_pages: 4,
    pro_base_pages: 6,
    pro_includes: ["bilingual", "booking", "listings"], // heavy components Pro covers flat
    // #38 (ratified 2026-07-23) — Présence is the one-pager/digital-card tier: simple-only.
    // Any component (booking/listings) or a bilingual mirror is a multi-page-tool capability →
    // forces the Standard floor. Tier is capability-defined, not page-count-only.
    presence_excludes_components: true,
    presence_excludes_bilingual: true,
  },

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
