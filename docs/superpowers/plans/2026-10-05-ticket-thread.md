# Ticket — fil unique — Implementation Plan

> **For agentic workers:** une tâche = un commit. Sous-agents en **Sonnet**. Cases `- [ ]` pour le suivi.

**Goal:** La page de détail d'un ticket n'a plus qu'une carte « Fil du ticket » (description, notes, commentaires avec pièces jointes, événements, interventions, temps), une colonne info réduite à un quart avec valeurs tronquées + infobulle, et les pièces jointes se joignent aux commentaires.

**Architecture:** côté serveur, `TicketAttachment.commentId` (nullable) et `POST /tickets/:id/comments` en JSON ou multipart (multer `files`, 5 max) ; côté client, fonction pure `buildTicketThread()` + rendu dans `TicketDetailPage`, composant `Tooltip` CSS.

**Spec:** `docs/superpowers/specs/2026-10-05-ticket-thread-design.md`

## Global Constraints

- Mêmes règles d'upload qu'aujourd'hui (`ALLOWED_ATTACHMENT_MIMES/EXTS`, 10 Mo, `uploads/tickets`).
- Migration Prisma versionnée obligatoire (`prisma migrate diff` entre `schema.postgres.prisma` commité et régénéré par `scripts/make-postgres-schema.mjs`) ; ne jamais éditer `schema.postgres.prisma` à la main.
- Docs API (`server/docs/API.md`, `openapi.json`) à jour dans la tâche serveur.
- Fin de commit : `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_016RAaqJuUGBhiYy8YDw5EDR`.

---

### Task 1: Serveur — pièces jointes de commentaire

**Files:** `server/src/prisma/schema.prisma`, `server/src/prisma/schema.postgres.prisma` (régénéré), `server/src/prisma/migrations/20261005_comment_attachments/migration.sql`, `server/src/routes/tickets.ts`, `server/docs/API.md`, `server/docs/openapi.json`, `server/tests/api/ticket-comment-attachments.test.ts`.

- [ ] Schéma : `commentId String?` + relation `comment` (onDelete Cascade) + `@@index([commentId])` sur `TicketAttachment` ; `attachments TicketAttachment[]` sur `TicketComment`. `npm run db:push` (dev), régénérer `schema.postgres.prisma`, générer la migration par `migrate diff`, vérifier le SQL (ALTER TABLE ADD COLUMN + index + FK).
- [ ] `POST /:id/comments` : middleware `attachmentUpload.array('files', 5)` appliqué seulement si `content-type` multipart (sinon JSON inchangé) ; validation `content` optionnel si `req.files.length > 0` ; création du commentaire puis des `ticketAttachment` avec `commentId` ; en cas d'erreur, `unlink` des fichiers écrits ; réponse 201 avec `attachments` ; audit par fichier ; plus de `logTicketEvent ATTACHMENT_ADDED`.
- [ ] Supprimer `POST /:id/attachments`. `GET /:id` : `comments: { include: { attachments } }`, `attachments: { where: { commentId: null } }`.
- [ ] Docs API + openapi (multipart sur comments, route supprimée, `comments[].attachments`).
- [ ] Tests de la spec §5 (serveur). `npx vitest run` vert, `tsc` propre. Commit `feat(tickets): pieces jointes rattachees aux commentaires`.

### Task 2: Client — infobulle, fil du ticket, colonne compacte

**Files:** `client/src/components/ui/Tooltip.tsx` (+ test), `client/src/lib/ticketThread.ts` (+ test), `client/src/pages/tickets/TicketsPage.tsx`.

- [ ] `Tooltip` CSS (spec §4).
- [ ] `buildTicketThread(ticket)` + types `ThreadItem` (spec §4), test unitaire (ordre, `TIME_ADDED` remplacé, intervention, orphelin).
- [ ] `TicketDetailPage` : grille 4 colonnes ; Informations avec `truncate` + `Tooltip` ; Temps passé réduit ; suppression des cartes Historique / Interventions / Pièces jointes et de `AttachmentsCard` ; nouvelle carte « Fil du ticket » (rendu par type d'item), formulaire de commentaire avec fichiers (`FormData`), puces de pièces jointes téléchargeables (blob + en-tête auth) avec suppression si `tickets:update`.
- [ ] Types `TicketDetail` : `comments[].attachments`, `attachments` orphelines.
- [ ] `npm run lint` 0 erreur, `npm run build`, `npm test` verts. Commit `feat(tickets): fil unique du ticket, pieces jointes dans les commentaires, colonne info compacte`.

### Task 3: Clôture

- [ ] Vérification manuelle dev (Chrome) : commentaire avec deux fichiers, téléchargement, suppression d'une pièce jointe, infobulle sur une valeur longue, intervention et temps visibles dans le fil.
- [ ] JOURNAL/PROGRESS locaux, push, déploiement Plesk (CLI) + vérification `migrate deploy` dans le journal Passenger, test prod par Clément.
