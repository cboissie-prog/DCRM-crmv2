# Pipeline — archivage des opportunités gagnées et perdues

**Date** : 2026-10-05
**Statut** : validé par Clément (délai par défaut 30 jours), à enchaîner après le chantier Tickets

## 1. Problème

Les colonnes Gagné et Perdu du Kanban affichent toutes les opportunités fermées, sans limite dans
le temps. Avec l'activité, elles deviennent illisibles. Il faut qu'elles disparaissent du Kanban au
bout d'un moment **sans rien perdre** : ni la donnée, ni les indicateurs (gagnées ce mois, CA,
objectifs), qui doivent continuer de compter toutes les opportunités.

## 2. Périmètre

**Inclus** : archivage automatique par ancienneté (réglage), archivage et désarchivage manuels,
panneau Archives par pipeline, filtre `archived` sur l'API des opportunités.
**Exclus** : tout changement des calculs de dashboard, objectifs, prévisions et rapports (ils ne
passent pas par le filtre) ; archivage des leads ; suppression de données.

## 3. Modèle et règles

- `Opportunity.archivedAt DateTime?` : date d'archivage, `null` = visible dans le Kanban.
- `Opportunity.autoArchive Boolean @default(true)` : `false` après un désarchivage manuel, pour
  que l'automate ne la range pas à nouveau la nuit suivante.
- Réglage `pipelineArchiveAfterDays` (défaut `30`, label « Archiver les opportunités gagnées/perdues
  après (jours) »), dans `DEFAULTS` de `server/src/routes/settings.ts`, exposé dans Réglages > Système
  à côté des autres seuils.
- **Automate** `runOpportunityArchiving()` dans `server/src/scheduler.ts` : archive (`archivedAt = now`)
  toute opportunité dont l'étape est `isWon` ou `isLost` (via `PipelineStage` du pipeline de
  l'opportunité), `closedAt < now - N jours`, `archivedAt = null`, `autoArchive = true`. Lancé dans le
  cron quotidien existant et une fois au démarrage du serveur. Retourne `{ archived: n }`, loggué.
- Migration `20261005_opportunity_archive` (deux colonnes, valeurs par défaut, aucune donnée à migrer).

## 4. API (`server/src/routes/pipeline.ts`)

- `GET /opportunities` : nouveau paramètre `archived` = `exclude` | `only` | `all` (défaut `all`,
  pour ne pas changer les autres appelants). `exclude` → `archivedAt: null` ; `only` → `archivedAt: { not: null }`,
  tri `closedAt desc`.
- `PATCH /opportunities/:id/archive` (permission `pipeline:update`) : `archivedAt = now`. Refus `400 NOT_CLOSED`
  si l'étape n'est ni gagnée ni perdue.
- `PATCH /opportunities/:id/unarchive` (permission `pipeline:update`) : `archivedAt = null`, `autoArchive = false`.
- `PATCH /opportunities/:id/stage` existant : passer vers une étape ni gagnée ni perdue remet
  `archivedAt = null` et `autoArchive = true` (réouverture d'une affaire).
- `GET /opportunities/archives/count?pipelineId=` : `{ won: n, lost: n }` pour les liens des colonnes.
- Docs API.md + openapi.json.

## 5. Client (`client/src/pages/pipeline/PipelinePage.tsx`)

- La requête du Kanban passe `archived=exclude`.
- Colonnes `isWon` / `isLost` : sous les cartes, un lien discret « 14 archivées » (compteur de
  `/opportunities/archives/count`, masqué si 0) ouvre le **panneau Archives** (`Drawer` existant,
  titre « Archives — Gagnées » ou « Archives — Perdues ») : champ de recherche (titre, entreprise),
  liste groupée par mois de clôture (« Septembre 2026 »), chaque ligne = titre, entreprise, montant HT,
  date de clôture, bouton « Désarchiver » (permission `pipeline:update`) et clic sur la ligne =
  ouverture de la modale d'édition existante. Chargement via `GET /opportunities?archived=only&pipelineId=&stage=`.
- Menu « Actions » des cartes gagnées/perdues : entrée « Archiver » (permission `pipeline:update`),
  toast « Opportunité archivée », invalidation de `pipeline-opportunities` et du compteur.
- Réglages > Système : champ numérique « Archiver les opportunités gagnées/perdues après (jours) »
  (1 à 3650) dans la section « Seuils d'alerte ».
- Aucun changement sur le dashboard ni les objectifs.

## 6. Tests

- Serveur `tests/api/pipeline-archives.test.ts` : `archived=exclude/only/all` ; `archive` sur une
  opportunité ouverte → 400 ; `archive` puis `unarchive` (autoArchive passe à false) ; changement
  d'étape vers une étape ouverte désarchive ; `runOpportunityArchiving()` avec un réglage à 30 jours
  archive une opportunité fermée il y a 40 jours, pas celle fermée hier, ni celle `autoArchive = false` ;
  `archives/count`.
- Client : lint, build, tests existants ; vérification manuelle dans Chrome (archiver, lien compteur,
  panneau, désarchiver, carte revenue dans la colonne).
