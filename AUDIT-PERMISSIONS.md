# Audit de couverture API × Rôles & Permissions

**Date** : 2026-08-12 · **Périmètre** : les 178 endpoints REST (26 fichiers de routes), les 65 permissions seedées, les gardes côté client (`App.tsx`, sidebar, onglets Paramètres).
**Question posée** : chaque fonctionnalité peut-elle être configurée par rôle en **refusé** (aucun accès), **consultable** (lecture seule) et/ou **modifiable** (écriture) ?

---

## Synthèse

| Verdict | Modules |
|---------|---------|
| ✅ Couverture complète (refusé / consultable / modifiable) | Sociétés, Contacts, Tickets, Pipeline, Pipelines, Objectifs (perso + entreprise), Automatisations, Connaissances, Équipements, Contrats, Produits, Appels, Rendez-vous, Paramètres, Dashboard, Doc API |
| ⚠️ Couvert mais granularité fusionnée (pas de « consultable seul ») | Rôles & Permissions, Clés API, Partages de calendriers, Licences/Parc (fusionnés avec Équipements) |
| ❌ Aucune permission — refus impossible | **Notifications**, **Google Calendar (connexion/synchro individuelle)** |
| ⚠️ Gardé par rôle codé en dur (non délégable via la page Rôles) | Détail/édition utilisateur, templates de pipeline, diagnostic OVH, sync Google globale, clés sensibles de Paramètres — plus 3 entrées de sidebar côté client |

**Bilan chiffré** : sur 178 endpoints, 149 sont gardés par une permission, 12 sont volontairement publics (auth, NPS par jeton, webhooks, health), 10 sont « authentifié seulement » (dont 5 notifications et 4 Google), 7 exigent un rôle codé en dur.

---

## 1. Trous de couverture (refus impossible)

### T1 — Notifications : aucune permission ❌
`GET /notifications`, `PATCH /notifications/read-all`, `PATCH /notifications/:id/read`, `DELETE /notifications/all`, `DELETE /notifications/:id` : simple `authenticate`, aucun `requirePermission`. Les données sont limitées à `req.userId` (pas de fuite entre utilisateurs), mais **aucun rôle ne peut être privé des notifications**, et une clé API scopée y a accès… jamais, en fait : les scopes ne contiennent que des permissions, or ces routes n'en exigent aucune → **une clé API à zéro droit peut lire/supprimer les notifications de son propriétaire**. C'est le seul module dans ce cas.
→ Recommandation : permission `notifications:read` (+ éventuellement `notifications:manage` pour suppression), attribuée à tous les rôles par défaut pour ne rien casser.

### T2 — Google Calendar individuel : aucune permission ❌
`GET /google/status`, `GET /google/calendar/connect`, `POST /google/calendar/disconnect`, `POST /google/calendar/sync` : authentifié seulement. Impossible d'interdire à un rôle de connecter son agenda Google. Même remarque que T1 pour les clés API à zéro droit (status/connect/disconnect/sync accessibles).
→ Recommandation : permission `google:calendar` (catégorie Agenda), attribuée par défaut aux rôles qui ont `appointments:read`.

### T3 — Page Dashboard non gardée côté client ⚠️
La route `/` (App.tsx) n'a pas de `ProtectedRoute permission="dashboard:read"` — un rôle sans `dashboard:read` voit la page se charger puis toutes ses tuiles tomber en 403. L'API est bien protégée ; c'est un trou d'UX, pas de sécurité.
→ Recommandation : garder `/` par `dashboard:read` avec un écran d'accueil de repli, ou considérer le dashboard comme toujours accessible et retirer la permission (choix produit).

### T4 — `GET /calendar-access/mine` : authentifié seulement ℹ️
Donnée personnelle (ses calendriers visibles) — acceptable, mais logiquement liée à `appointments:read`. Faible priorité.

---

## 2. Gardes par rôle codé en dur (non délégables)

Côté **serveur** — un rôle personnalisé créé dans la page Rôles ne pourra jamais recevoir ces capacités, quelle que soit sa configuration :

| Endpoint | Garde actuelle | Impact |
|----------|----------------|--------|
| `GET /users/:id` | soi-même ou ADMIN/MANAGER | un rôle custom avec `users:read` ne voit pas le détail des autres |
| `PUT /users/:id`, `PATCH /users/:id/password` | soi-même ou ADMIN | `users:update` existe mais n'est pas utilisée ici |
| `/pipelines/templates/*` (8 routes) | permission pipeline + rôle ADMIN | non délégable |
| `GET /calls/sync-ovh/debug` | rôle ADMIN | non délégable (+ inaccessible par clé API — voulu) |
| `POST /google/calendar/sync/all` | rôle ADMIN | non délégable (+ inaccessible par clé API — voulu) |
| `PUT /settings/:key` (clés sensibles) | `settings:write` + rôle ADMIN | garde-fou sécurité — à conserver tel quel |

Côté **client** — la sidebar filtre par **rôle** là où l'API filtre par **permission** ; un rôle custom doté de la permission n'a pas l'entrée de menu (mais peut accéder par URL directe), et inversement :

| Entrée sidebar | Garde sidebar | Garde route/API réelle |
|----------------|---------------|------------------------|
| Automatisations | rôles `['ADMIN']` | `automation:read` |
| NPS | rôles `['ADMIN','MANAGER']` | `dashboard:read` (route) |
| Utilisateurs | rôles `['ADMIN','MANAGER']` | `users:read` |

→ Recommandation : passer ces trois entrées sur `permission:` (le mécanisme existe déjà dans la sidebar), et remplacer les checks `users/:id` par les permissions `users:read`/`users:update` (en conservant le self-service).

---

## 3. Granularité fusionnée (pas de mode « consultable seul »)

| Fonctionnalité | Permission actuelle | Limite |
|----------------|--------------------|--------|
| Rôles & Permissions | `settings:roles` (unique) | impossible de laisser *consulter* les rôles sans pouvoir les *modifier* |
| Clés API | `apikeys:manage` (unique) | lecture et gestion fusionnées — mineur (self-service) |
| Partages de calendriers | `calendars:manage_access` (unique) | pas de consultation seule des partages |
| Licences | réutilise `equipment:*` | impossible de donner les licences sans les équipements |
| Parc (vue d'ensemble) | réutilise `equipment:read` | idem |
| NPS interne | via `dashboard:read` | pas de permission NPS dédiée (la sidebar compense par rôle — cf. §2) |

→ Recommandation si besoin réel : `settings:roles_read`, `licenses:*` dédiées, `nps:read`. À ne créer **que si un cas d'usage existe** — chaque permission ajoutée alourdit la page Rôles.

## 4. Incohérences de doctrine (mineures mais à trancher)

- **Imports** : `companies:import` est une permission dédiée, mais l'import CSV de contacts n'exige que `contacts:create`. → soit créer `contacts:import`, soit supprimer `companies:import` (aligner).
- **Exports** : l'export CSV tickets exige `tickets:export` (dédiée), mais les exports sociétés/contacts n'exigent que `*:read`. → même arbitrage.
- **`GET /targets/eligible-users`** exige `targets:write` (lecture gardée par une permission d'écriture) — voulu (réservé à qui attribue les objectifs), à documenter comme tel.
- **`GET /companies/entreprises/search`** exige `companies:create` — voulu (pré-remplissage de création), cohérent.

## 5. Ce qui est déjà exemplaire ✅

- Les 13 modules métier principaux suivent le triptyque `read`/`create+update`/`delete` → refusé/consultable/modifiable s'exprime parfaitement rôle par rôle.
- La recherche globale (`/search`) filtre chaque catégorie de résultats par la permission correspondante (catégorie non permise = silencieusement vide) — bon modèle.
- Appels : `calls:listen` sépare l'écoute des enregistrements de la consultation des fiches — la granularité la plus fine de l'app.
- Objectifs : `targets:read` / `targets:read_all` / `targets:write` + `company_targets:read/write` — modèle à suivre.
- Clés API scopées (12/08) : le RBAC s'applique désormais aussi par clé, intersection avec les droits du propriétaire.

---

## Plan d'action — ✅ P1+P2 IMPLÉMENTÉS le 2026-08-12 (même jour)

**P1 — Trous réels** ✅
1. ✅ `notifications:read` (catégorie Notifications, tous rôles par défaut) sur les 5 routes notifications — ferme aussi l'accès des clés API à zéro droit. Cloche du header masquée sans la permission.
2. ✅ `google:calendar` (catégorie Agenda, tous rôles par défaut) sur les 4 routes Google individuelles. Encart Google de la page Agenda masqué sans la permission.

**P2 — Cohérence rôle/permission** ✅
3. ✅ Sidebar : Automatisations → `automation:read`, NPS → `nps:read` (nouvelle permission, catégorie NPS, ADMIN+MANAGER par défaut, `/dashboard/nps` regardée aussi), Utilisateurs → `users:read`.
4. ✅ Routes `/users/:id` : self-service inchangé, `users:read` (détail) / `users:update` (édition, mot de passe d'un tiers) à la place des rôles en dur ; protection de cible : un compte ADMIN (rôle, statut, mot de passe) reste modifiable uniquement par un ADMIN (`*`), et `canAssignRole` borne toujours l'escalade de rôle.
5. ✅ Routes client `/` (dashboard:read), `/notifications` (notifications:read), `/nps` (nps:read) gardées.

Non-régression : `tests/api/audit-gates.test.ts` (8 tests). Suite complète : 201 tests verts. Seed dev rejoué ; **seed prod à rejouer au prochain déploiement**.

**P3 — Non traité (optionnel, sur besoin réel)**
6. `settings:roles_read`, `licenses:*` dédiées, doctrine imports/exports (`contacts:import`, exports read vs permission dédiée). Restent aussi, par choix : templates de pipeline / diagnostic OVH / sync Google globale / clés sensibles Paramètres en rôle ADMIN codé en dur (routes d'administration technique).
