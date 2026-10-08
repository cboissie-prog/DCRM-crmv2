# Module Prospection — Implementation Plan

> **For agentic workers:** la session principale commite ; sous-agents en **Sonnet** ; cases `- [ ]`.
> ⚠️ Un push sur `master` déploie en production automatiquement : ne jamais pousser depuis un agent.

**Goal:** Onglet Prospection (Ma journée, Listes, Suivi), écran de traitement avec actions à un clic et cadence, panneau de suivi commun prospect/opportunité, qualification vers le pipeline, alertes de suivi sur le Kanban.

**Spec:** `docs/superpowers/specs/2026-10-08-prospection-module-design.md`

## Global Constraints

- Migration Prisma versionnée (`make-postgres-schema.mjs` + `prisma migrate diff`), JSON stocké en `String` (SQLite).
- Toute action écrit une `Activity` avec `userId` = auteur ; `lastActivityAt` tenu par le serveur.
- Permissions `prospection:read|write|manage` dans `seed.ts` (seed idempotent rejoué au déploiement) ; référentiels dans `reference-domains.ts`.
- Docs API à jour. Commits suffixés `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_016RAaqJuUGBhiYy8YDw5EDR`.

---

### Task 1: Serveur — modèle, listes, prospects, actions, qualification, stats, alertes

**Files:** `server/src/prisma/schema.prisma` (+ postgres, migration `20261008_prospection_module`), `server/src/lib/reference-domains.ts`, `server/src/prisma/seed.ts` (permissions), `server/src/routes/settings.ts` (DEFAULTS), nouveau `server/src/routes/prospection.ts` (monté sur `/api/prospection` dans `app.ts`), nouveau `server/src/services/prospectActions.ts` (logique des actions, partagée par prospection et pipeline), `server/src/routes/pipeline.ts` (`GET /:id` enrichi, `POST /:id/actions`, `alert`, journalisation `STAGE_CHANGED`), `server/docs/API.md`, `server/docs/openapi.json`, `server/tests/api/prospection-module.test.ts`.

- [ ] Schéma + migration (spec §3). Référentiels + permissions + réglages.
- [ ] `services/prospectActions.ts` : `applyAction(opportunityId, action, payload, userId)` (table du §4, cadence via `getSettingInt`, auto-attribution, `Activity`, `lastActivityAt`, `MEETING_SET` → `Appointment`).
- [ ] Routes listes, prospects, actions, qualify, stats (spec §4). Import dans une liste : factoriser la logique d'import existante en fonction partagée `importProspectRows(rows, { listId?, pipelineId?, stage?, source, assignedToId })`.
- [ ] Pipeline : `activities` dans `GET /:id`, `POST /:id/actions`, champ `alert` + filtre, `STAGE_CHANGED` journalisé.
- [ ] Docs + tests (spec §6). `tsc` + `vitest` verts.

### Task 2: Client — Prospection (Ma journée, Listes, écran de liste, panneau de suivi, import dans une liste, réglages)

**Files:** `client/src/pages/prospection/ProspectionPage.tsx` (onglets), `MyDayTab.tsx`, `ListsTab.tsx`, `ProspectListPage.tsx`, `StatsTab.tsx`, `client/src/components/prospection/FollowUpDrawer.tsx`, `ProspectActionBar.tsx`, `QualifyModal.tsx`, `client/src/lib/prospectActions.ts` (+ test), `client/src/components/ui/ImportProspectsModal.tsx` (étape Liste, appel `POST /prospection/lists/:id/import`), `client/src/App.tsx`, `client/src/components/layout/Sidebar.tsx`, `client/src/pages/settings/SettingsPage.tsx` (section Prospection), `client/src/types/index.ts`.

- [ ] Types, routes, menu, permissions côté client.
- [ ] `prospectActions.ts` : catalogue des actions (clé, libellé, icône, raccourci, formulaire requis, validation) + test.
- [ ] `FollowUpDrawer` (spec §5, mode `prospect` | `deal`), `ProspectActionBar` (mini-formulaires inline), `QualifyModal`.
- [ ] Pages : Ma journée, Listes (cartes, Nouvelle liste, Importer, Archiver), écran de traitement (dérivé de `PipelineListView` : factoriser ce qui peut l'être sans casser la vue Liste du pipeline), Suivi.
- [ ] Import : étape « Liste » ; retrait du bouton Importer de la vue Liste du pipeline.
- [ ] Lint 0 erreur, build, tests.

### Task 3: Client — Pipeline (après Task 2)

**Files:** `client/src/pages/pipeline/PipelinePage.tsx`, `PipelineListView.tsx`.

- [ ] Carte Kanban : prochaine action + pastille d'alerte ; filtre « Alertes » ; clic titre → `FollowUpDrawer` mode `deal`.
- [ ] Vue Liste : colonne Prochaine action + alerte, ouverture du panneau.
- [ ] Lint, build, tests.

### Task 4: Clôture

- [ ] Vérification Chrome (spec §6 manuel) sur une branche ou en local AVANT push ; push = déploiement ; contrôle migration + seed (permissions, référentiels) en prod ; journal local ; mémoire.
