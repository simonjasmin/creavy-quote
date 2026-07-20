// SPEC #24 — public projection of the scan event spine. DEFAULT-DENY: only types
// present in this table reach the browser, rendered server-side through FR/EN
// templates (data/config, not code branches). Raw event data NEVER ships — only
// the rendered string + a stable type. Confidence gates enforce #23 (no platform/
// builder claim below high confidence). Prices, tiers, review flags, needs_browser,
// signal internals, and negative judgments are absent by construction (not listed).

import type { ScanEvent } from "./events.ts";

export type Lang = "fr" | "en";
type Render = (d: Record<string, any>) => string;
type Entry = { fr: Render; en: Render; gate?: (d: Record<string, any>) => boolean };

// The whitelist IS this table. Findings are phrased as facts (never negatives).
export const PUBLIC_TEMPLATES: Record<string, Entry> = {
  scan_started: { fr: () => "Démarrage de l'analyse…", en: () => "Starting analysis…" },
  url_normalized: { fr: (d) => `Analyse de ${d.host}…`, en: (d) => `Analyzing ${d.host}…` },
  sitemap_found: { fr: () => "Plan du site trouvé", en: () => "Sitemap found" },
  sitemap_absent: { fr: () => "Exploration des liens de votre site…", en: () => "Exploring your site's links…" },
  page_fetched: { fr: (d) => `Lecture de vos pages… ${d.n} de ~${d.approx}`, en: (d) => `Reading your pages… ${d.n} of ~${d.approx}` },
  platform_detected: { fr: (d) => `Site ${d.platform} détecté`, en: (d) => `${d.platform} site detected`, gate: (d) => d.confidence === "high" }, // #23
  builder_detected: { fr: (d) => `Constructeur ${d.builder} détecté`, en: (d) => `${d.builder} page builder detected`, gate: (d) => d.confidence === "high" }, // #23
  bilingual_paired: { fr: () => "Versions française et anglaise détectées — comptées comme un seul site bilingue", en: () => "French and English versions detected — counted as a single bilingual site" },
  blog_classified: { fr: (d) => `${d.count} articles de blogue — comptés séparément de vos pages`, en: (d) => `${d.count} blog posts — counted separately from your pages` },
  core_count_progress: { fr: (d) => `${d.count} pages principales…`, en: (d) => `${d.count} core pages…` },
  scan_complete: { fr: () => "Analyse terminée", en: () => "Analysis complete" },

  // #32 A4 — the stage-2 assessment streams on the same spine. `assessment_chunk` carries
  // real model prose ALREADY in the prospect's language (the honest "watch it think"); the
  // template passes it through. start/complete/unavailable are fixed FR/EN strings — the
  // complete event's internal data (complexity/confidence/flag) is IGNORED here, so no
  // internal ever ships (projectPublic returns only the rendered text, never raw data).
  assessment_started: { fr: () => "Analyse détaillée de votre site…", en: () => "Detailed analysis of your site…" },
  assessment_chunk: { fr: (d) => String(d.text ?? ""), en: (d) => String(d.text ?? "") },
  assessment_complete: { fr: () => "Analyse détaillée prête", en: () => "Detailed analysis ready" },
  assessment_unavailable: { fr: () => "Notre équipe prépare votre analyse détaillée.", en: () => "Our team is preparing your detailed analysis." },
};

export const PUBLIC_WHITELIST: ReadonlySet<string> = new Set(Object.keys(PUBLIC_TEMPLATES));

// Returns the rendered public string (+ stable type) or null if the event is not
// public (default-deny) or fails a confidence gate. NEVER returns raw data.
export function projectPublic(ev: ScanEvent, lang: Lang): { type: string; text: string } | null {
  const entry = PUBLIC_TEMPLATES[ev.type];
  if (!entry) return null; // default-deny
  const data = ev.data ?? {};
  if (entry.gate && !entry.gate(data)) return null; // e.g. below high confidence (#23)
  return { type: ev.type, text: entry[lang](data) };
}

// The prospect stream: the ordered list of rendered public lines for a log.
export function projectStream(events: ScanEvent[], lang: Lang): { type: string; text: string }[] {
  const out: { type: string; text: string }[] = [];
  for (const ev of events) { const p = projectPublic(ev, lang); if (p) out.push(p); }
  return out;
}
