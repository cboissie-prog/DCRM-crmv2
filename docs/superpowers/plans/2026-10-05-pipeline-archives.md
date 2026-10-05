# Pipeline — archivage des opportunités — Implementation Plan

> **For agentic workers:** une tâche = un commit. Sous-agents en **Sonnet**. Cases `- [ ]` pour le suivi.

**Goal:** Les opportunités gagnées/perdues quittent le Kanban après N jours (réglage, 30 par défaut) ou sur action manuelle, restent consultables et désarchivables dans un panneau Archives, sans toucher aux indicateurs.

**Spec:** `docs/superpowers/specs/2026-10-05-pipeline-archives-design.md`

## Global Constraints

- Migration Prisma versionnée via `prisma migrate diff` (schéma postgres régénéré par `scripts/make-postgres-schema.mjs`).
- `GET /opportunities` sans `archived` reste strictement identique (dashboard, objectifs, exports inchangés).
- Docs API à jour. Commits suffixés `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_016RAaqJuUGBhiYy8YDw5EDR`.

---

### Task 1: Serveur — modèle, automate, routes

**Files:** `server/src/prisma/schema.prisma` (+ postgres régénéré, migration `20261005_opportunity_archive`), `server/src/routes/settings.ts` (DEFAULTS), `server/src/scheduler.ts`, `server/src/routes/pipeline.ts`, `server/docs/API.md`, `server/docs/openapi.json`, `server/tests/api/pipeline-archives.test.ts`.

- [ ] `archivedAt DateTime?`, `autoArchive Boolean @default(true)` sur `Opportunity` ; `db:push`, postgres régénéré, migration.
- [ ] `DEFAULTS.pipelineArchiveAfterDays = { value: '30', label: 'Archiver les opportunités gagnées/perdues après (jours)' }`.
- [ ] `runOpportunityArchiving()` (spec §3) exporté de `scheduler.ts`, appelé dans le cron quotidien et au boot (`startScheduler`).
- [ ] Routes : `archived` sur `GET /opportunities` ; `PATCH /opportunities/:id/archive` (400 `NOT_CLOSED` si étape ouverte) ; `PATCH /opportunities/:id/unarchive` ; `PATCH /opportunities/:id/stage` désarchive vers une étape ouverte ; `GET /opportunities/archives/count?pipelineId=` → `{ won, lost }` (déclarer AVANT `/opportunities/:id`).
- [ ] Docs + tests (spec §6). `tsc` + `vitest` verts. Commit `feat(pipeline): archivage des opportunites gagnees/perdues (auto + manuel)`.

### Task 2: Client — Kanban, panneau Archives, réglage

**Files:** `client/src/pages/pipeline/PipelinePage.tsx`, `client/src/pages/settings/SettingsPage.tsx`.

- [ ] Requête Kanban avec `archived: 'exclude'`.
- [ ] Compteur `['pipeline-archives-count', pipelineId]` ; lien « N archivées » en pied des colonnes gagné/perdu ; `ArchivesDrawer` (Drawer existant) avec recherche, groupement par mois, « Désarchiver », clic = modale d'édition.
- [ ] Entrée « Archiver » dans le menu Actions des cartes gagnées/perdues.
- [ ] Réglages > Système : champ `pipelineArchiveAfterDays` (section Seuils d'alerte).
- [ ] Lint 0 erreur, build, tests. Commit `feat(pipeline): panneau Archives, archivage manuel, reglage du delai`.

### Task 3: Clôture

- [ ] Vérification manuelle Chrome (archiver, compteur, panneau, désarchiver), journal local, push, déploiement CLI Plesk, contrôle `migrate deploy` + log `[ARCHIVES]` au boot.
