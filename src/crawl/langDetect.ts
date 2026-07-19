// SPEC #26 — hand-rolled fr/en content detector. Deterministic, zero-dep,
// fixture-tested. High-frequency stopwords + diacritic density on visible text.
// Reason on record: stock WordPress themes ship lang="en-US" on French sites
// constantly — metadata lies, content doesn't. So content DECIDES; <html lang>
// is only a fallback when content is inconclusive.

export type Lang = "fr" | "en";

const FR_STOP = new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "est", "vous", "nous", "pour", "avec", "sur", "dans", "votre", "vos", "nos", "notre", "plus", "au", "aux", "ce", "cette", "ces", "qui", "que", "ne", "pas", "son", "ses", "par", "ou", "où", "être", "mais", "donc", "car", "sont", "nos", "leur", "leurs", "chez", "sans", "sous", "entre", "tout", "tous", "toute", "notre", "vos", "réservation", "accueil", "coordonnées", "à"]);
const EN_STOP = new Set(["the", "and", "is", "are", "you", "we", "for", "with", "on", "in", "your", "our", "of", "to", "this", "that", "which", "not", "a", "an", "be", "from", "at", "as", "it", "or", "by", "have", "has", "was", "were", "will", "can", "all", "about", "home", "contact", "us", "our", "book", "booking"]);
const DIACRITICS = /[àâäéèêëïîôöùûüÿçœæ]/gi;

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .slice(0, 20000);
}

export function detectLang(text: string): Lang | "unknown" {
  const words = text.toLowerCase().match(/[a-zàâäéèêëïîôöùûüÿçœæ]{1,}/g) || [];
  let fr = 0, en = 0;
  for (const w of words) { if (FR_STOP.has(w)) fr++; if (EN_STOP.has(w)) en++; }
  const diac = (text.match(DIACRITICS) || []).length;
  const frScore = fr + diac * 0.6; // diacritics are a strong French signal
  const enScore = en;
  if (frScore < 2 && enScore < 2) return "unknown";
  if (frScore >= enScore * 1.25) return "fr";
  if (enScore >= frScore * 1.25) return "en";
  return "unknown";
}

// Root-tree language for #26 pairing. Signal stack: content DECIDES; <html lang>
// demoted to a fallback only when content is inconclusive.
export function inferRootLang(html: string): Lang | undefined {
  const byContent = detectLang(visibleText(html));
  if (byContent !== "unknown") return byContent;
  const m = html.match(/<html[^>]+lang=["']([a-z]{2})/i);
  if (m) { const l = m[1].toLowerCase(); if (l === "fr" || l === "en") return l; }
  return undefined;
}
