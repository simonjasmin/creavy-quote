# Assessment model benchmark (#32 Fork 1) — GATE input

Live run over 4 assessable golden(s), both languages where bilingual. Candidates: **claude-sonnet-4-6** vs **claude-opus-4-8**.

## Summary — latency & tokens

| site | lang | model | complexity | conf | flag | words | latency | out-tok |
|---|---|---|---|---|---|--:|--:|--:|
| syn-couvreur-dated *(syn)* | fr | claude-sonnet-4-6 | low | high |  | 114 | 8288ms | 295 |
| syn-couvreur-dated *(syn)* | fr | claude-opus-4-8 | standard | high |  | 92 | 7280ms | 354 |
| syn-electricien-sain *(syn)* | fr | claude-sonnet-4-6 | low | high |  | 77 | 6470ms | 231 |
| syn-electricien-sain *(syn)* | fr | claude-opus-4-8 | low | high | ⚑ | 87 | 5828ms | 320 |
| syn-plomberie-bilingue *(syn)* | fr | claude-sonnet-4-6 | standard | high |  | 70 | 5461ms | 210 |
| syn-plomberie-bilingue *(syn)* | fr | claude-opus-4-8 | standard | high |  | 93 | 7856ms | 354 |
| syn-plomberie-bilingue *(syn)* | en | claude-sonnet-4-6 | standard | high |  | 94 | 5830ms | 208 |
| syn-plomberie-bilingue *(syn)* | en | claude-opus-4-8 | low | high |  | 93 | 5513ms | 286 |
| toituresmarcelpouliot | fr | claude-sonnet-4-6 | low | medium |  | 90 | 8452ms | 281 |
| toituresmarcelpouliot | fr | claude-opus-4-8 | standard | medium |  | 89 | 7969ms | 363 |

## Side-by-side prose

### syn-couvreur-dated [fr] *(labelled-synthetic)*

**claude-sonnet-4-6** — low/high · factors: dated_design, thin_but_clean, heavy_media

> Votre site WordPress présente quatre pages — accueil, services, réalisations et contact — pour votre entreprise de toiture en Mauricie. Le problème, c'est que le pied de page affiche « © 2009 », optimisé pour Internet Explorer 6 et requiert Flash Player : des technologies abandonnées depuis plus de dix ans. Sur les appareils mobiles d'aujourd'hui, ça ne fonctionne tout simplement pas, et un client potentiel qui ne peut pas voir vos photos de chantier appelle le concurrent. La bonne nouvelle : votre contenu de base — vos services, votre territoire, votre expérience depuis 1998 — est solide et réutilisable. On repart ça propre, moderne et lisible sur cellulaire. L'estimation est juste en dessous.

**claude-opus-4-8** — standard/high · factors: dated_design, thin_but_clean

> Votre site a quatre pages sur WordPress : accueil, services, réalisations et contact, avec un contenu clair sur la toiture résidentielle en Mauricie. Le hic, c'est que le site montre son âge : mention d'Internet Explorer 6, dépendance à Adobe Flash et pied de page daté de 2009. Aujourd'hui, Flash n'existe plus dans les navigateurs, alors des sections risquent de ne rien afficher chez vos visiteurs. La bonne nouvelle : tout votre contenu — services, coordonnées, réalisations — est réutilisable. On repart la base propre et moderne. L'estimation est juste en dessous.

### syn-electricien-sain [fr] *(labelled-synthetic)*

**claude-sonnet-4-6** — low/high · factors: thin_but_clean

> Votre site WordPress est en bon état dans l'ensemble : cinq pages claires, un contenu professionnel bien ciblé pour Laval et les Laurentides, et vos accréditations RBQ bien en vue. Le contenu est mince sur certaines pages — les réalisations et les services pourraient en dire beaucoup plus pour convaincre un client hésitant. La bonne nouvelle : la structure est saine et réutilisable; on peut étoffer et moderniser sans repartir de zéro. L'estimation est juste en dessous.

**claude-opus-4-8** — low/high ⚑ · factors: thin_but_clean, minimal_content

> Votre site est en bon état : cinq pages bien structurées, une licence RBQ affichée et vos services d'électricien clairement présentés. Rien d'urgent ici. Le contenu reste par contre assez mince — chaque page tient en quelques lignes, ce qui laisse peu de place pour bien expliquer vos réalisations ou rassurer un client avant qu'il vous appelle. La bonne nouvelle : la base est solide et réutilisable. Si vous voulez étoffer les pages ou moderniser l'image, voici ce que ça donnerait — l'estimation est juste en dessous.

### syn-plomberie-bilingue [fr] *(labelled-synthetic)*

**claude-sonnet-4-6** — standard/high · factors: thin_but_clean, multilingual_content

> Votre site WordPress est un trois pages bilingue (français et anglais) pour un service de plomberie résidentielle et commerciale sur la Rive-Sud. Le contenu est clair et les deux versions linguistiques sont en place — c'est une bonne base. Si vous souhaitez convertir plus de visiteurs, ajouter un formulaire de contact ou une prise de rendez-vous en ligne renforcerait l'impact de votre service d'urgence 24/7. L'estimation est juste en dessous.

**claude-opus-4-8** — standard/high · factors: thin_but_clean, multilingual_content

> Votre site compte trois pages, offert en français et en anglais avec les deux versions bien en place. Le contenu est clair : services de plomberie, secteur desservi, numéro pour rejoindre. C'est propre, mais c'est mince — chaque service est décrit en une ou deux lignes, et il n'y a pas grand-chose pour rassurer un client qui hésite (photos de réalisations, témoignages, formulaire). La bonne nouvelle : la base bilingue est solide et réutilisable. On peut étoffer le contenu et rendre l'ensemble plus convaincant sans repartir de zéro. L'estimation est juste en dessous.

### syn-plomberie-bilingue [en] *(labelled-synthetic)*

**claude-sonnet-4-6** — standard/high · factors: multilingual_content, thin_but_clean

> Your site is a clean, three-page WordPress plumbing business in both English and French — home, services, and contact, all mirrored across both languages. There are no glaring technical emergencies here, which is good news. That said, maintaining a bilingual site does add a layer of ongoing complexity, and the content is currently quite thin — a rebuild is an opportunity to flesh out your services, strengthen your local SEO for the South Shore, and make sure both language versions are working as hard as they can for you. The estimate is just below.

**claude-opus-4-8** — low/high · factors: thin_but_clean, multilingual_content

> Your site has three pages on WordPress, offered in both French and English, covering your plumbing services and contact details clearly. The home page has some placeholder content ("x x x") sitting where real text should be — that's the kind of gap visitors notice, and it undercuts the trust a service business relies on. The good news: your structure is solid and your bilingual setup is already in place, so we'd just fill in what's missing and tidy the presentation. If you'd like to freshen things up, the estimate is just below.

### toituresmarcelpouliot [fr]

**claude-sonnet-4-6** — low/medium · factors: thin_but_clean, dated_design

> Votre site, c'est quatre pages pour une entreprise de couverture établie depuis 1976 — Accueil, Services, Réalisations et Contact. Le design date de 2017 et ça paraît : la mise en page est vieillotte, la page Réalisations semble vide de photos visibles dans le code, et l'adresse courriel Videotron affichée publiquement nuit à la crédibilité professionnelle. La bonne nouvelle, c'est que votre contenu est solide — 40 ans d'expérience, licences RBQ, quatre secteurs bien définis — tout ça se repart proprement dans une base moderne. L'estimation est juste en dessous.

**claude-opus-4-8** — standard/medium · factors: thin_but_clean, dated_design

> Votre site compte quatre pages bien organisées : accueil, services, réalisations et contact, avec un contenu clair qui met en valeur vos 40 ans d'expérience, votre licence RBQ et vos secteurs d'activité. Par contre, le pied de page affiche encore 2017, la page Réalisations semble vide de projets et le tout accuse son âge côté présentation. La bonne nouvelle : votre texte est solide et entièrement réutilisable. On pourrait rafraîchir l'image, remplir votre galerie de réalisations et rendre le formulaire de soumission plus efficace. L'estimation est juste en dessous.

