# Prospection — Implementation Plan

> **For agentic workers:** une tâche = un commit (la session principale commite). Sous-agents en **Sonnet**. Cases `- [ ]`.

**Goal:** Un seul objet « opportunité » (leads supprimés), une vue Liste de prospection sur la page Pipeline, un Kanban limité à 5 cartes par colonne, et un import CSV de prospects avec correspondance des colonnes.

**Spec:** `docs/superpowers/specs/2026-10-05-prospection-design.md`

## Global Constraints

- Migration Prisma versionnée (`prisma migrate diff` entre `schema.postgres.prisma` de HEAD et le régénéré par `scripts/make-postgres-schema.mjs`), puis **compléter à la main** le SQL avec la conversion des leads et la suppression des automatisations `LEAD_SCORE_THRESHOLD` (seule exception à la règle « jamais à la main » : il s'agit du fichier migration.sql, pas du schéma).
- `GET /pipeline/opportunities` sans nouveau paramètre : comportement inchangé.
- Montants en euros HT. Référentiel `lead_source` conservé tel quel (il sert maintenant aux opportunités et aux contacts).
- Docs API à jour. Commits suffixés `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_016RAaqJuUGBhiYy8YDw5EDR`.

---

### Task 1: Serveur — modèle, suppression des leads, routes de prospection, bulk, import

**Files:** `server/src/prisma/schema.prisma` (+ postgres régénéré, migration `20261006_prospection`), `server/src/routes/pipeline.ts`, `server/src/automation-engine.ts`, `server/src/routes/contacts.ts` (include `leads` à retirer, export CSV), `server/src/prisma/seed-demo.ts` (leads démo → opportunités), `server/src/routes/calls.ts` si référence, `server/docs/API.md`, `server/docs/openapi.json`, `server/tests/api/prospection.test.ts`, suppression/adaptation des tests qui touchent `/leads`.

- [ ] Schéma : champs `source`, `prospectStatus`, `lastContactedAt`, `callAttempts`, `nextAction` sur `Opportunity` ; retrait de `Lead`, `Opportunity.leadId/lead`, `Contact.leads`. `db:push` en dev (avec `--accept-data-loss` si nécessaire pour la table Lead), postgres régénéré, migration générée puis complétée (spec §3 « Suppression de Lead » : conversion des leads non convertis AVANT le DROP, suppression des automatisations `LEAD_SCORE_THRESHOLD`).
- [ ] Routes `/leads*` supprimées ; `LEAD_SCORE_THRESHOLD` retiré de l'engine (type + `fireAutomations`).
- [ ] `POST/PUT /opportunities` : `source` (validé `lead_source` via `checkReferences`), `prospectStatus`, `nextAction`, `remindAt`.
- [ ] `GET /opportunities` : filtres `prospectStatus`, `source`, `remindToday`, `neverContacted`, `staleDays`, `search` ; `sortBy`/`sortOrder` (liste blanche, `company` → `company.name`).
- [ ] `PATCH /opportunities/:id/prospect` (spec §4), `POST /opportunities/bulk`, `POST /opportunities/import/csv` (spec §4, transaction par lots de 50, dédup entreprise insensible à la casse, contact par email puis nom+prénom, pas de doublon d'opportunité ouverte par entreprise/pipeline).
- [ ] Docs + tests (spec §6 serveur). `tsc` + `vitest` verts. Commit `feat(prospection): leads fusionnes dans les opportunites, statut de prospection, bulk, import CSV`.

### Task 2: Client — bascule Kanban/Liste, Kanban allégé, vue Liste, import avec correspondance, nettoyage leads

**Files:** `client/src/pages/pipeline/PipelinePage.tsx`, nouveau `client/src/pages/pipeline/PipelineListView.tsx`, nouveau `client/src/components/ui/ImportProspectsModal.tsx`, nouveau `client/src/lib/csvMapping.ts` (+ test), `client/src/App.tsx` (route `/leads` → redirection), `client/src/components/layout/Sidebar.tsx`, `client/src/pages/calls/CallsPage.tsx` (lead depuis appel → opportunité), `client/src/pages/contacts/ContactDetailPage.tsx` (section leads si présente), `client/src/pages/automations/AutomationsPage.tsx` (trigger retiré), `client/src/types/index.ts`, suppression `client/src/pages/pipeline/LeadsPage.tsx`.

- [ ] Types `Opportunity` : nouveaux champs. Suppression de `LeadsPage.tsx`, du menu, de la route (redirection), du trigger d'automatisation.
- [ ] Bascule Kanban | Liste (localStorage + `?view=`), filtres communs.
- [ ] Kanban : 5 cartes par colonne, tri rappel/activité, « Afficher les N autres ».
- [ ] `PipelineListView` (spec §5) : colonnes, actions à un clic (`PATCH /prospect`), rappel (menu de dates), éditions en ligne (`PUT`), filtres dans l'URL, tri serveur, pagination, sélection multiple → `POST /bulk`.
- [ ] `OpportunityModal` : champs Source, Prochaine action, Rappel.
- [ ] `ImportProspectsModal` en 3 étapes (spec §5) + `lib/csvMapping.ts` (normalisation, synonymes, auto-détection, mémorisation localStorage) + test.
- [ ] Appels : « Créer une opportunité depuis l'appel ».
- [ ] Lint 0 erreur, build, tests. Commit `feat(prospection): vue Liste, Kanban allege, import CSV avec correspondance, suppression de la page Leads`.

### Task 3: Clôture

- [ ] Vérification manuelle Chrome (spec §6 manuel), journal local, push, déploiement CLI Plesk, contrôle de la migration (table `Lead` absente, colonnes présentes) et du boot.
