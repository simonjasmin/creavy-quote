// Writes human-labelled ground_truth manifest.json into each fixture dir.
// SPIKE CODE — /spikes, never imported by src.
// Ground truth was established by inspecting the harvested root.html + headers
// (generator meta, asset CDNs, platform headers) and ruling out stripped-WP on
// the custom set (no wp-json / api.w.org / wp-content anywhere).

import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const OUT = "fixtures/sites";

// slug -> { platform, builder }. builder only for WordPress; "unknown" where no
// major builder signal was present (theme/Gutenberg — not scored for builder).
const LABELS = {
  // --- WordPress (vanilla / theme / Gutenberg — builder unknown) ---
  "plombiermontreal-com": { platform: "wordpress", builder: "unknown" },
  "toitureqc-com": { platform: "wordpress", builder: "unknown" },
  "toiturealpha-ca": { platform: "wordpress", builder: "unknown" },
  "l2toiture-com": { platform: "wordpress", builder: "unknown" },
  "expair-ca": { platform: "wordpress", builder: "unknown" },
  "refrigerationeverest-com": { platform: "wordpress", builder: "unknown" },
  "airclimatisationvs-ca": { platform: "wordpress", builder: "unknown" },
  "boucherlortie-com": { platform: "wordpress", builder: "unknown" },
  "csmelectrique-com": { platform: "wordpress", builder: "unknown" },
  "xavierpaysagiste-com": { platform: "wordpress", builder: "unknown" },
  "lasouche-ca": { platform: "wordpress", builder: "unknown" },
  "labarberie-com": { platform: "wordpress", builder: "unknown" },
  "salonjumbojumbo-com": { platform: "wordpress", builder: "unknown" },
  "coifferieinternationale-com": { platform: "wordpress", builder: "unknown" },
  // --- WordPress + builder ---
  "plombierdemontreal-com": { platform: "wordpress", builder: "divi" },
  "pureplomberie-com": { platform: "wordpress", builder: "elementor" },
  "plomberie-chauffage-montreal-ca": { platform: "wordpress", builder: "elementor" }, // also WPBakery
  "pierrehamelin-ca": { platform: "wordpress", builder: "elementor" },
  "amenagementdupaysage-com": { platform: "wordpress", builder: "elementor" },
  "paysagistevilledequebec-ca": { platform: "wordpress", builder: "elementor" },
  "coiffuredistinctive-ca": { platform: "wordpress", builder: "elementor" },
  "itemconstruction-com": { platform: "wordpress", builder: "elementor" },
  "quebecelectricien-ca": { platform: "wordpress", builder: "wpbakery" },
  "anniesimardphoto-com": { platform: "wordpress", builder: "beaver" },
  // --- Wix ---
  "protectoit-com": { platform: "wix", builder: null },
  "clphotographe-com": { platform: "wix", builder: null },
  "estcequontecoiffe-com": { platform: "wix", builder: null },
  "beautemarc-com": { platform: "wix", builder: null },
  // --- Squarespace ---
  "vincentlabonte-com": { platform: "squarespace", builder: null },
  "myriamtphotographe-com": { platform: "squarespace", builder: null },
  // --- Shopify ---
  "articho-ca": { platform: "shopify", builder: null },
  "arloca-com": { platform: "shopify", builder: null },
  "monshackauquebec-com": { platform: "shopify", builder: null },
  "lempreintecoop-com": { platform: "shopify", builder: null },
  "signelocal-com": { platform: "shopify", builder: null },
  // --- Duda ---
  "mchenryplumbing-ca": { platform: "duda", builder: null },
  "mtlplomberie-ca": { platform: "duda", builder: null },
  // --- Square Online (Weebly lineage) ---
  "lespaceprive-square-site": { platform: "square_online", builder: null },
  // --- Custom / static (no platform markers; ICP "best leads") ---
  "plomberiemontreal-ca": { platform: "custom", builder: null },
  "plomberiefdussault-ca": { platform: "custom", builder: null },
  "toiture-quebec-ca": { platform: "custom", builder: null },
  "toituredelacapitale-com": { platform: "custom", builder: null },
  "toituresmarcelpouliot-com": { platform: "custom", builder: null },
  "lajoiecvac-com": { platform: "custom", builder: null },
  "robertgingrasinc-com": { platform: "custom", builder: null },
  "amenagementpaysager-ca": { platform: "custom", builder: null },
  "artisansdupaysage-com": { platform: "custom", builder: null },
  "paysagesgenest-com": { platform: "custom", builder: null },
  "creationsdici-ca": { platform: "custom", builder: null },
  "entreprisescardinal-com": { platform: "custom", builder: null },
};

// best-effort bilingual signal (for the bounder tour; not scored by the fingerprint spike)
function detectBilingual(body) {
  const langs = new Set();
  for (const m of body.matchAll(/hreflang=["']([a-z]{2})(?:-[a-z]{2})?["']/gi)) langs.add(m[1].toLowerCase());
  if (langs.has("fr") && langs.has("en")) return true;
  // path-mirror hint
  if (/href=["'][^"']*\/en\//i.test(body) && /href=["'][^"']*\/fr\//i.test(body)) return true;
  return false;
}

const dirs = (await readdir(OUT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

// prune fixtures with no usable body (harvest errors, e.g. NXDOMAIN typos)
let pruned = 0;
for (const slug of dirs) {
  const files = await readdir(join(OUT, slug));
  if (!files.includes("root.html")) { await rm(join(OUT, slug), { recursive: true, force: true }); pruned++; }
}

const kept = dirs.filter((s) => LABELS[s]);
const unlabeled = dirs.filter((s) => LABELS[s] === undefined && s !== undefined);
const missing = Object.keys(LABELS).filter((s) => !dirs.includes(s));

for (const [slug, gt] of Object.entries(LABELS)) {
  if (!dirs.includes(slug)) continue;
  const hdr = JSON.parse(await readFile(join(OUT, slug, "root.headers.json"), "utf8"));
  const body = await readFile(join(OUT, slug, "root.html"), "utf8").catch(() => "");
  const manifest = {
    slug,
    requested_url: hdr.requested ?? null,
    final_url: hdr.final_url ?? null,
    ground_truth: { platform: gt.platform, builder: gt.builder ?? null, bilingual: detectBilingual(body) },
    labeled_by: "human (harvest inspection 2026-07-18)",
  };
  await writeFile(join(OUT, slug, "manifest.json"), JSON.stringify(manifest, null, 2));
}

console.log(`Manifests written: ${kept.length}`);
console.log(`Pruned (no body): ${pruned}`);
if (unlabeled.length) console.log(`UNLABELED fixture dirs (no manifest): ${unlabeled.join(", ")}`);
if (missing.length) console.log(`LABELS with no fixture: ${missing.join(", ")}`);
// platform histogram
const hist = {};
for (const gt of Object.values(LABELS)) hist[gt.platform] = (hist[gt.platform] || 0) + 1;
console.log("Platform histogram:", hist);
