// #32 Fork 3 — Voice A + the warm pivot, "severity follows evidence". Prompt assets as
// DATA (not woven into logic) so the voice is auditable and swappable.
//
// The two FR few-shots are RATIFIED VERBATIM (SPEC §2.10, founder 2026-07-20) — do not
// edit their text. The EN pair mirrors them faithfully and is shown in the tour report
// for a founder nod; it ships when the form language is EN.

import type { AssessLang } from "../types.ts";

export type FewShot = { findings: string; healthy: string };

// FR — ratified verbatim. `findings` = a real problem present (name it, state the
// consequence, one warm pivot, close to the estimate). `healthy` = no manufactured alarm.
export const FEWSHOTS_FR: FewShot = {
  findings:
    "Votre site a quatre pages sur WordPress. Le certificat de sécurité est expiré : vos " +
    "visiteurs voient un avertissement avant même d'arriver, et sur cellulaire, plusieurs " +
    "ferment l'onglet là. La bonne nouvelle : votre contenu est réutilisable. On repart la " +
    "base — même structure, refaite propre, rapide et sécurisée. L'estimation est juste en dessous.",
  healthy:
    "Votre site est en bon état : cinq pages bien structurées, certificat valide, contenu " +
    "clair. Une refonte n'est pas urgente. Si vous voulez moderniser l'image ou ajouter la " +
    "prise de rendez-vous en ligne, voici ce que ça donnerait — l'estimation est juste en dessous.",
};

// EN — faithful mirror of the ratified FR (same severity ladder, same warm pivot, same
// close). Shown in the tour report for a founder nod.
export const FEWSHOTS_EN: FewShot = {
  findings:
    "Your site has four pages on WordPress. The security certificate has expired: visitors " +
    "see a warning before they even land, and on mobile many close the tab right there. The " +
    "good news: your content is reusable. We rebuild the foundation — same structure, redone " +
    "clean, fast and secure. The estimate is just below.",
  healthy:
    "Your site is in good shape: five well-structured pages, a valid certificate, clear " +
    "content. A rebuild isn't urgent. If you'd like to modernize the look or add online " +
    "booking, here's what that would look like — the estimate is just below.",
};

export const fewshots = (lang: AssessLang): FewShot => (lang === "fr" ? FEWSHOTS_FR : FEWSHOTS_EN);
