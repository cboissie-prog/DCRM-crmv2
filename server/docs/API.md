# Documentation API — DCRM

API REST du CRM interne DCB Technologies. Cette documentation est générée depuis le code source des routes (`server/src/routes/`) et doit être mise à jour à chaque modification d'endpoint. Elle est consultable dans le CRM (Paramètres → Documentation API) et téléchargeable en Markdown (`API.md`) ou OpenAPI 3 (`openapi.json`).

## Base URL

```
http://localhost:3001/api          (dev)
https://<votre-domaine>/api        (prod)
```

## Authentification

Deux méthodes acceptées sur toutes les routes protégées :

### JWT (usage navigateur)
```
Authorization: Bearer <access_token>
```
Obtenu via `POST /auth/login`. Durée de vie : 15 minutes. Renouvelable via `POST /auth/refresh` (refresh token en cookie httpOnly, 7 jours, rotation à chaque refresh).

### Clé API (usage externe / intégrations)
```
X-API-Key: dcrm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Clés à durée de vie longue générées via `POST /apikeys`. Idéal pour Zapier, n8n, Make, scripts, webhooks entrants. La clé hérite des permissions de l'utilisateur qui l'a créée.

Détails du middleware `authenticate` (les deux modes sont essayés dans cet ordre) :
1. Header `X-API-Key` → clé hashée (SHA-256) comparée en base ; doit être active, non expirée, et son propriétaire actif. Une clé d'un ADMIN reçoit toutes les permissions (`*`).
2. Header `Authorization: Bearer <JWT>` → vérifié en HS256 ; rejeté si l'utilisateur est inactif ou si son `tokenVersion` a changé (déconnexion forcée après désactivation, changement de rôle ou de mot de passe).

### Permissions (RBAC)

Chaque route protégée exige soit une simple authentification, soit une **permission** au format `module:action` (ex. `contacts:read`). Les permissions sont attribuées aux rôles dans Paramètres → Rôles & Permissions. Les utilisateurs ADMIN ont toutes les permissions. Dans les tableaux ci-dessous, la colonne « Accès » indique : `Public`, `Authentifié`, `Permission <clé>`, `Rôle ADMIN` ou `Webhook`.

## Rate Limiting

| Scope | Limite |
|-------|--------|
| Global (`/api/*`) | 500 req / 15 min |
| Auth (login, forgot/reset-password, Google) | 20 req / 15 min |
| Webhook appels (`/calls/webhook`) | 120 req / 15 min |
| Notifications Google (`/google/notifications`) | 300 req / min |
| NPS public (`/nps`) | 30 req / 15 min |

## Format des Réponses

### Succès
```json
{
  "success": true,
  "data": { },
  "meta": { "total": 100, "page": 1, "limit": 25 }
}
```
`meta` n'est présent que sur les listes paginées.

### Erreur
```json
{
  "success": false,
  "error": {
    "code": "SNAKE_CASE_CODE",
    "message": "Message lisible"
  }
}
```

| Code HTTP | Code erreur | Signification |
|-----------|-------------|---------------|
| 400 | `VALIDATION_ERROR` | Corps de requête invalide (détail Zod dans `error.details`) |
| 401 | `UNAUTHORIZED` | Token absent, expiré ou clé API invalide |
| 403 | `FORBIDDEN` | Permission insuffisante |
| 404 | `NOT_FOUND` | Ressource introuvable |
| 409 | `CONFLICT` | Contrainte d'unicité ou état incompatible |
| 500 | `INTERNAL_ERROR` | Erreur serveur |

## Pagination

Les routes de liste acceptent :

```
?page=1&limit=25&sortBy=createdAt&sortOrder=desc&search=dupont
```

---

## Endpoints

### Health

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/health` | Public | État du serveur (`{ status, timestamp }`) |

---

### Auth `/api/auth`

Middleware `authenticate` supporte deux modes : Bearer JWT (header `Authorization: Bearer <token>`) OU clé API (header `X-API-Key`). Rate limiting dédié (20 req/15min) sur `/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/google`.

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| POST | `/auth/login` | Public | Connexion — retourne access token + cookie refresh httpOnly |
| POST | `/auth/refresh` | Public (cookie requis) | Rotation du refresh token, retourne un nouvel access token |
| POST | `/auth/logout` | Authentifié | Révoque le refresh token courant |
| POST | `/auth/forgot-password` | Public | Envoie un email de reset (réponse générique anti-énumération) |
| POST | `/auth/reset-password` | Public | Réinitialise le mot de passe via token reçu par email |
| GET | `/auth/me` | Authentifié | Profil de l'utilisateur courant |
| GET | `/auth/google` | Public | Redirige vers la page d'autorisation OAuth Google |
| GET | `/auth/google/callback` | Public | Callback OAuth2 Google — crée/lie le compte puis redirige vers le frontend |

**POST /auth/login**
```json
{
  "email": "string (email)",
  "password": "string (min 1)"
}
```
Réponse `200` : `{ user: { id, email, firstName, lastName, phone, avatar, role, isActive, createdAt, permissions: string[] }, accessToken }` + cookie httpOnly `refreshToken` (7j, `path=/api/auth`, `sameSite=strict`).
Erreurs spécifiques : `401 INVALID_CREDENTIALS`, `423 ACCOUNT_LOCKED` (verrouillage après 5 échecs, 15 min — message inclut le temps restant).

**POST /auth/refresh**
Pas de corps — lit le cookie `refreshToken`. Rotation : ancien token supprimé, nouveau créé et reposé en cookie.
Réponse `200` : `{ accessToken }`.
Erreurs : `401 UNAUTHORIZED` (cookie absent), `401 INVALID_TOKEN` (signature invalide, token absent en DB = réutilisation détectée → révocation de toutes les sessions de l'utilisateur, expiré, ou utilisateur inactif/introuvable).

**POST /auth/logout**
Pas de corps. Réponse `200` : `{ message: "Déconnecté avec succès" }` + `clearCookie('refreshToken')`.

**POST /auth/forgot-password**
```json
{ "email": "string (email)" }
```
Réponse `200` toujours identique (que l'email existe ou non) : `{ message: "Si cet email existe, un lien de réinitialisation a été envoyé." }`. Délai constant (~300ms) pour éviter l'énumération par timing.

**POST /auth/reset-password**
```json
{
  "token": "string (min 1)",
  "password": "string (min 10, ≥1 minuscule, ≥1 majuscule, ≥1 chiffre)"
}
```
Réponse `200` : `{ message: "Mot de passe réinitialisé avec succès" }`. Effets de bord : `tokenVersion++` (invalide tous les access tokens émis), déverrouille le compte, supprime tous les refresh tokens de l'utilisateur.
Erreur : `400 INVALID_TOKEN` (lien invalide ou expiré — validité 1h).

**GET /auth/me**
Réponse `200` : `{ id, email, firstName, lastName, phone, avatar, role, isActive, createdAt }` (pas de `permissions` ici, contrairement à `/login`).
Erreur : `404 NOT_FOUND`.

**GET /auth/google**
Pas de query documentée en entrée ; pose un cookie anti-CSRF `gauth_state` (10 min) et redirige (302) vers Google.
Erreur : `503 GOOGLE_DISABLED` si `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` absents.

**GET /auth/google/callback**
Query : `code`, `state`, `error` (fournis par Google). Vérifie le `state` contre le cookie `gauth_state`. Logique métier : lie par `googleId`, sinon par email existant, sinon auto-création si le domaine de l'email correspond au setting `googleAllowedDomain` (défaut `dcb-technologies.fr`) avec le rôle `googleAutoCreateRole` (défaut `COMMERCIAL`, jamais `ADMIN` même si le setting est forcé en base). Sur succès : pose le cookie `refreshToken`, redirige (302) vers `${FRONTEND_URL}/auth/google/success` (le client appelle ensuite `POST /auth/refresh` pour obtenir l'accessToken).
Réponses d'erreur JSON (pas de redirection) : `503 GOOGLE_DISABLED`, `400 INVALID_STATE`, `400 NO_ID_TOKEN`, `400 INVALID_ID_TOKEN`. Autres échecs métier → redirection 302 vers `${FRONTEND_URL}/login?error=google_unauthorized` ou `?error=account_disabled` (pas de code JSON).

---

### Utilisateurs `/api/users`

Toutes les routes exigent `authenticate` (posé via `router.use(authenticate)`).

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/users` | Permission `users:read` | Liste des utilisateurs |
| POST | `/users` | Permission `users:create` | Crée un utilisateur |
| GET | `/users/targets` | Permission `targets:read` | Liste des objectifs de vente |
| POST | `/users/targets` | Permission `targets:write` | Définit/met à jour un objectif |
| GET | `/users/:id` | Authentifié (soi-même, ou rôle ADMIN/MANAGER) | Détail d'un utilisateur |
| PUT | `/users/:id` | Authentifié (soi-même, ou rôle ADMIN) | Modifie un utilisateur |
| DELETE | `/users/:id` | Permission `users:delete` | Désactive un utilisateur (soft delete) |
| PATCH | `/users/:id/password` | Authentifié (soi-même, ou rôle ADMIN) | Change le mot de passe |

**GET /users**
Query : `includeInactive` (`"true"` pour inclure les comptes désactivés, défaut : actifs uniquement).
Réponse : `data: [{ id, email, firstName, lastName, phone, avatar, role, isActive, createdAt }]`.

**POST /users**
```json
{
  "email": "string (email)",
  "password": "string (min 10, ≥1 minuscule, ≥1 majuscule, ≥1 chiffre)",
  "firstName": "string (min 1)",
  "lastName": "string (min 1)",
  "phone": "string (optionnel)",
  "role": "string (optionnel, min 1)"
}
```
Contrôle `canAssignRole` : attribuer `ADMIN` requiert d'être ADMIN ; attribuer un rôle possédant une permission que l'appelant n'a pas lui-même est refusé (anti-escalade horizontale). Copie best-effort des pipelines templates vers le nouvel utilisateur (asynchrone, n'échoue jamais la requête).
Réponse `201` : `{ id, email, firstName, lastName, phone, role, isActive, createdAt }`.
Erreurs : `400 INVALID_ROLE` (rôle inconnu), `403 FORBIDDEN` (escalade refusée).

**GET /users/targets**
Réponse : `data: [{ ...SalesTarget, user: { id, firstName, lastName, avatar } }]`, triés par `period desc`.

**POST /users/targets**
```json
{
  "userId": "string (min 1)",
  "period": "string (min 1)",
  "target": "number (positif)"
}
```
Upsert par `(userId, period)`. Réponse : objet `SalesTarget`.

**GET /users/:id**
Réponse : `{ id, email, firstName, lastName, phone, avatar, role, isActive, createdAt }`.
Erreurs : `403 FORBIDDEN` (ni soi-même ni ADMIN/MANAGER), `404 NOT_FOUND`.

**PUT /users/:id**
```json
{
  "email": "string (email, optionnel)",
  "firstName": "string (min 1, optionnel)",
  "lastName": "string (min 1, optionnel)",
  "phone": "string (optionnel)",
  "role": "string (min 1, optionnel — ADMIN uniquement)",
  "isActive": "boolean (optionnel — ADMIN uniquement)"
}
```
Les champs `role`/`isActive` sont retirés du corps si l'appelant n'est pas ADMIN. Changer `role` ou `isActive` incrémente `tokenVersion` (invalide les access tokens déjà émis).
Réponse : `{ id, email, firstName, lastName, phone, role, isActive }`.
Erreurs : `403 FORBIDDEN`, `400 INVALID_ROLE`.

**DELETE /users/:id**
Pas de corps. Soft delete (`isActive: false`) + `tokenVersion++` + suppression de tous les refresh tokens de l'utilisateur.
Réponse : `{ message: "Utilisateur désactivé" }`.
Erreur : `400 BAD_REQUEST` (tentative de se désactiver soi-même).

**PATCH /users/:id/password**
```json
{
  "currentPassword": "string (optionnel — requis si l'appelant modifie SON PROPRE mot de passe et n'est pas ADMIN)",
  "newPassword": "string (min 10, ≥1 minuscule, ≥1 majuscule, ≥1 chiffre)"
}
```
`tokenVersion++` + révocation de tous les refresh tokens de l'utilisateur ciblé.
Réponse : `{ message: "Mot de passe mis à jour" }`.
Erreurs : `403 FORBIDDEN`, `400 VALIDATION_ERROR` (mot de passe actuel manquant, ou identique à l'ancien), `404 NOT_FOUND`, `401 INVALID_PASSWORD`.

---

### Rôles `/api/roles`

`authenticate` appliqué au montage (`app.use('/api/roles', authenticate, rolesRoutes)`), toutes les routes exigent en plus la permission `settings:roles`.

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/roles` | Permission `settings:roles` | Liste des rôles avec compteurs |
| GET | `/roles/permissions/all` | Permission `settings:roles` | Toutes les permissions, groupées par catégorie |
| GET | `/roles/:id` | Permission `settings:roles` | Détail d'un rôle avec ses permissions |
| POST | `/roles` | Permission `settings:roles` | Crée un rôle |
| PUT | `/roles/:id` | Permission `settings:roles` | Modifie le libellé d'un rôle |
| PUT | `/roles/:id/permissions` | Permission `settings:roles` | Remplace toutes les permissions d'un rôle |
| DELETE | `/roles/:id` | Permission `settings:roles` | Supprime un rôle |
| GET | `/permissions` (hors préfixe `/roles`, déclarée dans `app.ts`) | Permission `settings:roles` | Toutes les permissions, groupées par catégorie (doublon fonctionnel de `/roles/permissions/all`) |

**GET /roles**
Réponse : `data: [{ id, name, label, isSystem, permissionsCount, usersCount }]`, triés par `name asc`.

**GET /roles/permissions/all** et **GET /permissions**
Réponse : `data: { [category: string]: Permission[] }` (regroupement par `category`, `Permission = { id, key, category, ... }`).

**GET /roles/:id**
Réponse : `{ id, name, label, isSystem, usersCount, permissions: Permission[] }`.
Erreur : `404 NOT_FOUND`.

**POST /roles**
```json
{
  "name": "string (min 1) — normalisé en MAJUSCULES",
  "label": "string (min 1)"
}
```
Réponse `201` : objet `Role` créé (`isSystem: false`).
Erreur : `409 CONFLICT` (nom déjà pris).

**PUT /roles/:id**
```json
{ "label": "string (min 1)" }
```
Réponse : objet `Role` mis à jour.
Erreur : `404 NOT_FOUND`.

**PUT /roles/:id/permissions**
```json
{ "permissionIds": ["string", "..."] }
```
Remplace l'intégralité des permissions du rôle (transaction : delete + createMany) et révoque les refresh tokens de tous les utilisateurs de ce rôle (force une reconnexion avec les nouvelles permissions).
Réponse : `{ id, name, label, isSystem, permissions: Permission[] }`.
Erreurs : `404 NOT_FOUND`, `400 INVALID_PERMISSION_IDS` (un ou plusieurs ids inconnus).

**DELETE /roles/:id**
Pas de corps.
Réponse : `{ message: "Rôle supprimé avec succès" }`.
Erreurs : `404 NOT_FOUND`, `403 FORBIDDEN` (rôle système), `409 CONFLICT` (rôle encore attribué à des utilisateurs).

---

### Clés API `/api/apikeys`

`authenticate` appliqué au montage, toutes les routes exigent en plus la permission `apikeys:manage`. Portée par utilisateur (chaque utilisateur ne voit/gère que ses propres clés).

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/apikeys` | Permission `apikeys:manage` | Liste des clés actives de l'utilisateur courant |
| POST | `/apikeys` | Permission `apikeys:manage` | Génère une nouvelle clé |
| DELETE | `/apikeys/:id` | Permission `apikeys:manage` | Révoque une clé |

**GET /apikeys**
Réponse : `data: [{ id, name, prefix, lastUsedAt, expiresAt, isActive, createdAt }]` (clés actives de `req.userId` uniquement).

**POST /apikeys**
```json
{
  "name": "string (trim, min 1)",
  "expiresAt": "string (date parseable, ex. YYYY-MM-DD — optionnel, nullable)"
}
```
Réponse `201` : `{ id, name, key, prefix, expiresAt, createdAt }` — `key` (valeur en clair, ex. `dcrm_xxx`) n'est renvoyée qu'à cet instant, seul son hash SHA-256 est stocké en base.

**DELETE /apikeys/:id**
Soft revoke (`isActive: false`), restreint à `req.userId`.
Réponse : `{ message: "Clé révoquée" }`.
Erreur : `404 NOT_FOUND` (clé inexistante ou appartenant à un autre utilisateur).

---

### Paramètres `/api/settings`

Toutes les routes exigent `authenticate` (posé via `router.use(authenticate)`).

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/settings` | Permission `settings:read` | Liste tous les paramètres (fusionnés avec les valeurs par défaut) |
| GET | `/settings/:key` | Permission `settings:read` | Un paramètre |
| PUT | `/settings/:key` | Permission `settings:write` (clés sensibles → rôle ADMIN uniquement) | Met à jour un paramètre |
| POST | `/settings/actions/run-contract-update` | Permission `settings:write` | Déclenche manuellement le job de mise à jour des statuts de contrats |

Clés connues (`DEFAULTS`) : `contractExpiringSoonDays`, `licenseExpiringSoonDays`, `schedulerEnabled`, `schedulerTime`, `companyName`, `companyLogoUrl`, `companyAddress`, `companyContactEmail`, `companyPhone`, `companySiret`, `companyVatNumber`, `callRecordingRetentionDays`, `slaHoursCritical`, `slaHoursHigh`, `slaHoursNormal`, `slaHoursLow`, `googleAllowedDomain`, `googleAutoCreateRole`.

**GET /settings**
Réponse : `data: [{ key, value, label }]` pour toutes les clés de `DEFAULTS` (valeur DB si présente, sinon valeur par défaut).

**GET /settings/:key**
Réponse : `{ key, value, label }`.
Erreur : `404 NOT_FOUND` (clé totalement inconnue, ni en DB ni dans `DEFAULTS`).

**PUT /settings/:key**
```json
{ "value": "string" }
```
`googleAllowedDomain` et `googleAutoCreateRole` sont réservées : modification refusée si l'appelant n'a pas la permission `*` (ADMIN), même s'il possède `settings:write`. Validation spécifique : `googleAllowedDomain` doit matcher un format de domaine (normalisé en minuscules, `@` initial retiré) ; `googleAutoCreateRole` ne peut jamais valoir `ADMIN` et doit référencer un rôle existant (normalisé en majuscules). Si `key` ∈ `{schedulerEnabled, schedulerTime}`, relance le scheduler en arrière-plan.
Réponse : objet `Setting` upserté (`{ key, value, label, ... }`).
Erreurs : `404 NOT_FOUND` (clé hors `DEFAULTS`), `403 FORBIDDEN` (clé sensible sans permission `*`), `400 INVALID_DOMAIN`, `400 INVALID_ROLE`.

**POST /settings/actions/run-contract-update**
Pas de corps. Réponse : `data` = résultat brut retourné par `runContractStatusUpdate()` (voir `server/src/scheduler.ts`, non typé ici).

---

## Notes générales

- Tous les routers de cette section sont montés derrière `router.use(authenticate)` : un jeton Bearer JWT (header `Authorization: Bearer <token>`) **ou** une clé API (header `X-API-Key`) est accepté indifféremment par `authenticate`.
- `requirePermission('xxx:yyy')` : accès refusé (403 `FORBIDDEN`) sauf si `req.permissions` contient la permission exacte ou `'*'` (les utilisateurs `ADMIN` reçoivent implicitement `'*'`).
- Codes d'erreur génériques renvoyés par `handleRouteError` (commun à toutes les routes ci-dessous, sauf mention contraire) : `VALIDATION_ERROR` (400, body Zod invalide), `CONFLICT` (409, contrainte d'unicité Prisma P2002), `NOT_FOUND` (404, Prisma P2025), `INVALID_REFERENCE` (400, clé étrangère invalide, Prisma P2003), `INTERNAL_ERROR` (500).
- Codes globaux du middleware `authenticate` : `UNAUTHORIZED` (401, token manquant), `INVALID_TOKEN` (401, JWT invalide/expiré/révoqué), `INVALID_API_KEY` (401), `EXPIRED_API_KEY` (401).

---

### Sociétés `/api/companies`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/companies` | Permission `companies:read` | Liste paginée des sociétés actives (recherche, filtre secteur, tri) |
| POST | `/companies` | Permission `companies:create` | Crée une société (géocodage auto de l'adresse si lat/lng absents) |
| GET | `/companies/entreprises/search` | Permission `companies:create` | Proxy vers l'API publique recherche-entreprises.api.gouv.fr (pré-remplissage fiche) |
| POST | `/companies/import/csv` | Permission `companies:import` | Import CSV en masse (dédoublonnage par nom) |
| GET | `/companies/export/csv` | Permission `companies:read` | Export CSV des sociétés (fichier `.csv`) |
| GET | `/companies/:id` | Permission `companies:read` | Détail d'une société avec ses relations |
| PUT | `/companies/:id` | Permission `companies:update` | Met à jour une société (re-géocodage si adresse modifiée) |
| DELETE | `/companies/:id` | Permission `companies:delete` | Suppression logique (`isActive: false`) |
| GET | `/companies/data/map` | Permission `companies:read` | Sociétés géolocalisées (pour affichage carte) |
| POST | `/companies/data/geocode-missing` | Permission `companies:update` | Lance un backfill de géocodage asynchrone (réponse immédiate, traitement en fond) |

**GET /companies**
Query : `search` (optionnel, filtre nom/SIRET/ville), `sector` (optionnel, filtre exact), `page` (défaut `1`), `limit` (défaut `25`, max `100`), `sortBy` (défaut `createdAt`, parmi `createdAt|updatedAt|name|city|sector|employees|annualRevenue`), `sortOrder` (`asc` ou défaut `desc`).
Réponse : `data` = tableau de sociétés (avec `_count: { contacts, tickets, contracts, opportunities }`), `meta: { total, page, limit }`.

**POST /companies**
```json
{
  "name": "string",
  "siret": "string (optionnel)",
  "vatNumber": "string (optionnel)",
  "website": "string (optionnel)",
  "sector": "string (optionnel)",
  "employees": "number entier (optionnel)",
  "annualRevenue": "number (optionnel)",
  "billingAddress": "string (optionnel)",
  "shippingAddress": "string (optionnel)",
  "city": "string (optionnel)",
  "postalCode": "string (optionnel)",
  "country": "string (optionnel)",
  "lat": "number (optionnel)",
  "lng": "number (optionnel)",
  "notes": "string (optionnel)",
  "tags": "string (optionnel)"
}
```
Si `lat`/`lng` absents et qu'une adresse exploitable est fournie, un géocodage automatique (best-effort, n'échoue jamais la création) est tenté. Réponse `201` : la société créée.

**GET /companies/entreprises/search**
Query : `q` (recherche, minimum 3 caractères sinon `data: []` immédiat).
Réponse : `data` = résultats bruts de `searchEntreprises` (API gouv.fr).

**POST /companies/import/csv**
```json
{
  "rows": [ { "Nom|Raison sociale|Company|Name": "string", "SIRET": "string", "N° TVA": "string", "Site web": "string", "Secteur": "string", "Ville": "string", "Code postal": "string", "Adresse": "string", "Notes": "string" } ]
}
```
`rows` : tableau d'objets `Record<string,string>` (clés libres, correspondance par nom de colonne CSV). Erreurs spécifiques : `EMPTY` (400, tableau vide), `TOO_MANY` (400, plus de 500 lignes). Déduplication : dans le fichier (par `name`) puis contre les sociétés existantes (même `name`).
Réponse : `data: { created, skipped, total }`.

**GET /companies/export/csv**
Query : `search`, `sector` (mêmes filtres que la liste, sans pagination/tri).
Réponse : fichier CSV (`Content-Type: text/csv`), colonnes Nom/Secteur/Ville/Code postal/SIRET/CA annuel/Effectif/Contacts/Tickets/Contrats/Créé le.

**GET /companies/:id**
Réponse : `data` = société avec `contacts` (actifs), `opportunities` (10 dernières), `tickets` (10 derniers), `contracts`, `equipments`, `licenses`, `activities` (20 dernières), `npsResponses`. Erreur `NOT_FOUND` (404) si absente.

**PUT /companies/:id**
Corps : même schéma que POST mais toutes les clés optionnelles (`.partial()`). Si un champ d'adresse (`billingAddress`, `city`, `postalCode`, `country`) est présent dans le corps et que `lat`/`lng` ne sont pas fournis explicitement, un re-géocodage est tenté si l'adresse combinée a changé ou si les coordonnées existantes sont nulles.
Réponse : la société mise à jour.

**DELETE /companies/:id**
Suppression logique uniquement (`isActive: false`). Réponse : `data: { message: "Entreprise supprimée" }`.

**GET /companies/data/map**
Réponse : `data` = tableau restreint (`id, name, city, lat, lng, sector, _count: { contacts, tickets }`) des sociétés actives ayant `lat` et `lng` non nuls.

**POST /companies/data/geocode-missing**
Pas de corps. Traite en tâche de fond (garde anti-concurrence globale) les sociétés actives sans `lat`/`lng` mais avec une adresse exploitable, à raison d'~1 requête/1,1 s (limite Nominatim).
Réponse immédiate : `data: { started: boolean, alreadyRunning?: true, pending: number }` (si un backfill est déjà en cours, `started: false, alreadyRunning: true`).

---

### Contacts `/api/contacts`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/contacts` | Permission `contacts:read` | Liste paginée des contacts actifs (recherche, filtres, tri) |
| POST | `/contacts` | Permission `contacts:create` | Crée un contact (normalisation téléphone + rattachement d'appels orphelins) |
| POST | `/contacts/import/csv` | Permission `contacts:create` | Import CSV en masse (dédoublonnage par email) |
| GET | `/contacts/export/csv` | Permission `contacts:read` | Export CSV des contacts |
| GET | `/contacts/:id` | Permission `contacts:read` | Détail d'un contact avec ses relations |
| PUT | `/contacts/:id` | Permission `contacts:update` | Met à jour un contact |
| DELETE | `/contacts/:id` | Permission `contacts:delete` | Suppression logique (`isActive: false`) |

**GET /contacts**
Query : `search` (optionnel, filtre prénom/nom/email/téléphone), `status` (optionnel, exact), `source` (optionnel, exact), `companyId` (optionnel, exact), `page` (défaut `1`), `limit` (défaut `25`, max `100`), `sortBy` (défaut `createdAt`, parmi `createdAt|updatedAt|firstName|lastName|email|status|source|leadScore`), `sortOrder` (`asc` ou défaut `desc`).
Réponse : `data` = tableau de contacts (avec `company: { id, name }`), `meta: { total, page, limit }`.

**POST /contacts**
```json
{
  "firstName": "string",
  "lastName": "string",
  "email": "string email (optionnel, ou chaîne vide)",
  "phone": "string (optionnel)",
  "mobile": "string (optionnel)",
  "position": "string (optionnel)",
  "companyId": "string (optionnel)",
  "source": "string (optionnel)",
  "status": "string (optionnel)",
  "tags": "string (optionnel)",
  "notes": "string (optionnel)"
}
```
`phone`/`mobile` sont normalisés (`phoneNormalized`/`mobileNormalized`) à la création. Les appels téléphoniques passés non liés (numéro correspondant) sont rattachés en arrière-plan (best-effort). Réponse `201` : le contact créé (avec `company`).

**POST /contacts/import/csv**
```json
{
  "rows": [ { "Prénom": "string", "Nom": "string", "Email": "string", "Téléphone": "string", "Mobile": "string", "Poste": "string", "Source": "string", "Statut": "string", "Entreprise": "string", "Notes": "string" } ]
}
```
Erreurs spécifiques : `EMPTY` (400, tableau vide), `TOO_MANY` (400, plus de 500 lignes). Lignes sans prénom ni nom ignorées. `Source`/`Statut` mappés via table interne (`site web→WEBSITE`, `appel entrant→PHONE_INBOUND`, `email→EMAIL`, `salon→TRADE_SHOW`, `référence→REFERRAL`, `prospection→COLD_CALL`, `réseaux sociaux→SOCIAL_MEDIA` ; `prospect→PROSPECT`, `client→CLIENT`, `inactif→INACTIVE`, `perdu→LOST`), valeur par défaut `OTHER`/`PROSPECT` sinon. `Entreprise` résolue par nom exact vers une société existante (sinon `companyId` non défini). Déduplication par `email` contre la base existante.
Réponse : `data: { created, skipped, total }`.

**GET /contacts/export/csv**
Query : `search`, `status`.
Réponse : fichier CSV, colonnes Prénom/Nom/Email/Téléphone/Mobile/Poste/Entreprise/Statut/Source/Score/Créé le.

**GET /contacts/:id**
Réponse : `data` = contact avec `company`, `leads`, `opportunities` (avec `company`), `tickets` (10 derniers), `activities` (20 dernières), `npsResponses`. Erreur `NOT_FOUND` (404) si absent.

**PUT /contacts/:id**
Corps : même schéma que POST, toutes les clés optionnelles (`.partial()`). Si `phone`/`mobile` présent dans le corps, les champs normalisés correspondants sont recalculés et un rattachement d'appels orphelins est retenté en arrière-plan.
Réponse : le contact mis à jour (avec `company`).

**DELETE /contacts/:id**
Suppression logique uniquement. Réponse : `data: { message: "Contact supprimé" }`.

---

### Recherche globale `/api/search`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/search` | Authentifié | Recherche transverse contacts/sociétés/tickets/opportunités (5 résultats max par type) |

**GET /search**
Query : `q` (requête, minimum 2 caractères sinon toutes les listes renvoyées vides).
Pas de `requirePermission` global sur la route : chaque catégorie de résultats est filtrée individuellement selon les permissions de l'utilisateur (`contacts:read`, `companies:read`, `tickets:read`, `pipeline:read`, ou `'*'` pour ADMIN) — une catégorie sans permission renvoie un tableau vide plutôt qu'une erreur 403.
Réponse :
```json
{
  "contacts": [{ "id": "string", "label": "string", "sub": "string", "link": "/contacts/:id", "type": "contact" }],
  "companies": [{ "id": "string", "label": "string", "sub": "string", "link": "/companies/:id", "type": "company" }],
  "tickets": [{ "id": "string", "label": "string", "sub": "string", "link": "/tickets/:id", "type": "ticket" }],
  "opportunities": [{ "id": "string", "label": "string", "sub": "string", "link": "/pipeline", "type": "opportunity" }]
}
```

---

### Notifications `/api/notifications`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/notifications` | Authentifié | Liste des 50 dernières notifications de l'utilisateur connecté |
| PATCH | `/notifications/read-all` | Authentifié | Marque toutes les notifications de l'utilisateur comme lues |
| PATCH | `/notifications/:id/read` | Authentifié | Marque une notification comme lue |
| DELETE | `/notifications/all` | Authentifié | Supprime toutes les notifications de l'utilisateur |
| DELETE | `/notifications/:id` | Authentifié | Supprime une notification |

Aucune de ces routes n'utilise `requirePermission` : elles sont scopées à l'utilisateur connecté (`userId: req.userId`) uniquement.

**GET /notifications**
Réponse : `data` = tableau de notifications, `meta: { unreadCount }`.

**PATCH /notifications/:id/read**
Réponse `data: { message: "Notification lue" }`. Erreur `NOT_FOUND` (404) si la notification n'existe pas ou n'appartient pas à l'utilisateur (aucune ligne mise à jour).

**DELETE /notifications/:id**
Suppression physique (`deleteMany`, scopée à l'utilisateur) — silencieuse si l'id n'existe pas ou n'appartient pas à l'utilisateur (pas de 404 renvoyé). Réponse : `data: { message: "Notification supprimée" }`.

---

### Tableau de bord `/api/dashboard`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/dashboard/today` | Permission `dashboard:read` | RDV du jour, tickets urgents et activités en retard de l'utilisateur connecté |
| GET | `/dashboard/stats` | Permission `dashboard:read` | Statistiques globales (contacts, sociétés, tickets, contrats, pipeline, MRR/ARR, alertes) |
| GET | `/dashboard/revenue` | Permission `dashboard:read` | Chiffre d'affaires gagné par mois (série temporelle) |
| GET | `/dashboard/churn-risks` | Permission `dashboard:read` | Score de risque de churn par société (top 10) |
| GET | `/dashboard/kpis` | Permission `dashboard:read` | 4 KPIs globaux condensés |
| GET | `/dashboard/charts` | Permission `dashboard:read` | Données pour graphiques (pipeline par étape, tickets par statut) |
| GET | `/dashboard/alerts` | Permission `dashboard:read` | Contrats expirant sous 60 jours + opportunités inactives depuis 14 jours |
| GET | `/dashboard/nps` | Permission `dashboard:read` | Score NPS agrégé (promoteurs/passifs/détracteurs) |

**GET /dashboard/today**
Réponse : `data: { appointments, urgentTickets, overdueActivities }` — `appointments` = RDV du jour où l'utilisateur est participant (avec `contacts`) ; `urgentTickets` = 10 tickets max, priorité `HIGH`/`CRITICAL`, statut ouvert, assignés à l'utilisateur ; `overdueActivities` = 10 activités max non complétées, `dueDate` ≤ fin de journée, assignées à l'utilisateur.

**GET /dashboard/stats**
Réponse : `data` = objet avec `contacts { total, newThisMonth }`, `companies { total }`, `tickets { open, critical, newThisMonth }`, `contracts { active, expiringSoon }`, `opportunities { open, wonThisMonth, pipelineValue, wonValueThisMonth, wonValueLastMonth }`, `mrr`, `arr` (MRR calculé depuis les contrats actifs, `monthlyAmount` ou `annualAmount/12`), `alerts { licensesExpiringSoon, warrantyExpiringSoon, contractsExpiringSoon, criticalTickets }`, `pipeline` (groupBy Prisma par stage), `recentActivities` (10 dernières, avec `user`, `contact`, `company`).

**GET /dashboard/revenue**
Query : `months` (défaut `12`, borné entre `1` et `24`).
Réponse : `data` = tableau `{ month: "YYYY-MM", label: "ex: janv. 26", value: number }` pour chaque mois de la période, valeur = somme des opportunités gagnées closes sur le mois.

**GET /dashboard/churn-risks**
Réponse : `data` = tableau (max 10, triés par score décroissant, score ≥ 30 uniquement) de `{ company: { id, name, city }, score, daysSinceContact, openTickets, hasActiveContract }`. Score calculé heuristiquement : +40 si >90j sans contact (+20 si >60j, +10 si >30j), +30 si ≥3 tickets ouverts (+10 si ≥1), +20 si pas de contrat actif.

**GET /dashboard/kpis**
Réponse : `data: { contactsCount, openTickets, pipelineWeightedValue, wonThisMonth: { count, value } }` — `pipelineWeightedValue` = somme des opportunités ouvertes pondérées par leur probabilité (`value * probability/100`).

**GET /dashboard/charts**
Réponse : `data: { pipelineByStage, ticketsByStatus }` — `pipelineByStage` = `[{ stage, stageName, count, value }]` (opportunités ouvertes uniquement, `stageName` résolu depuis `PipelineStage` en base) ; `ticketsByStatus` = `[{ status, label, count }]` (tous statuts, `label` traduit via table statique NEW/IN_PROGRESS/WAITING_CLIENT/RESOLVED/CLOSED, sinon fallback = `status` brut).

**GET /dashboard/alerts**
Réponse : `data: { expiringContracts, staleOpportunities }` — `expiringContracts` = 10 max, statut `ACTIVE`/`EXPIRING_SOON`, `endDate` dans les 60 jours ; `staleOpportunities` = 10 max, opportunités ouvertes non mises à jour depuis ≥14 jours.

**GET /dashboard/nps**
Réponse : `data: { score, promoters, passives, detractors, total, responses }` (`responses` = 20 dernières réponses). `score` = `((promoteurs - détracteurs) / total) * 100` arrondi ; promoteur si `score ≥ 9`, passif si `7 ≤ score ≤ 8`, détracteur si `score ≤ 6`. Si aucune réponse : tous les champs à `0`/`[]`.

---

Toutes les routes ci-dessous exigent au minimum `authenticate` (Bearer JWT ou header `X-API-Key`), appliqué via `router.use(authenticate)` en tête de chaque fichier. La colonne « Accès » précise en plus la permission (`requirePermission`) et/ou le rôle exigé. `ADMIN` (via JWT ou clé API) possède `permissions: ['*']` et passe tous les `requirePermission`.

Codes d'erreur génériques (via `handleRouteError`, valables sur toutes les routes sauf mention contraire) :
- `400 VALIDATION_ERROR` — corps de requête invalide (premier message Zod)
- `404 NOT_FOUND` — ressource Prisma introuvable (P2025)
- `409 CONFLICT` — contrainte d'unicité violée (P2002)
- `400 INVALID_REFERENCE` — clé étrangère invalide (P2003)
- `500 INTERNAL_ERROR` — erreur serveur

---

### Pipeline `/api/pipeline`

Fichier : `server/src/routes/pipeline.ts`. Gère les leads et les opportunités.

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/pipeline/leads` | Permission `pipeline:read` | Liste paginée des leads (filtrable) |
| POST | `/pipeline/leads` | Permission `pipeline:create` | Crée un lead |
| PUT | `/pipeline/leads/:id` | Permission `pipeline:update` | Met à jour un lead (partiel) |
| PATCH | `/pipeline/leads/:id/status` | Permission `pipeline:update` | Change le statut d'un lead |
| DELETE | `/pipeline/leads/:id` | Permission `pipeline:delete` | Supprime un lead |
| POST | `/pipeline/leads/:id/convert` | Permission `pipeline:update` | Convertit un lead en opportunité |
| GET | `/pipeline/opportunities` | Permission `pipeline:read` | Liste paginée des opportunités (filtrable) |
| POST | `/pipeline/opportunities` | Permission `pipeline:create` | Crée une opportunité |
| POST | `/pipeline/opportunities/reattach-orphans` | Permission `pipeline:update` | Rattache au pipeline par défaut les opportunités sans `pipelineId` |
| GET | `/pipeline/opportunities/:id` | Permission `pipeline:read` | Détail d'une opportunité |
| PUT | `/pipeline/opportunities/:id` | Permission `pipeline:update` | Met à jour une opportunité (partiel) |
| PATCH | `/pipeline/opportunities/:id/stage` | Permission `pipeline:update` | Déplace une opportunité vers une autre étape (drag & drop Kanban) |
| DELETE | `/pipeline/opportunities/:id` | Permission `pipeline:delete` | Supprime une opportunité (produits liés en cascade, activités détachées) |

**GET /pipeline/leads**
Query : `status` (optionnel, ex. `NEW`), `source` (optionnel), `page` (défaut 1), `limit` (défaut 25, max 100).
Réponse : `data` = tableau de leads (avec `contact.company`), `meta: { total, page, limit }`.

**POST /pipeline/leads**
```json
{
  "contactId": "string",
  "title": "string",
  "source": "string (optionnel)",
  "description": "string (optionnel)",
  "score": "int 0-100 (optionnel)"
}
```
Réponse `201` : le lead créé. Si `score > 0`, déclenche l'automatisation `LEAD_SCORE_THRESHOLD` (asynchrone, non bloquant).

**PUT /pipeline/leads/:id**
Corps identique à la création, tous les champs optionnels (`.partial()`). Redéclenche `LEAD_SCORE_THRESHOLD` si `score` est fourni et > 0.

**PATCH /pipeline/leads/:id/status**
```json
{ "status": "NEW | CONTACTED | QUALIFIED | CONVERTED | LOST | UNREACHABLE" }
```

**POST /pipeline/leads/:id/convert**
```json
{
  "pipelineId": "string (optionnel, sinon pipeline par défaut actif)",
  "stage": "string (optionnel, sinon 1re étape non gagnée/perdue du pipeline, ou 'QUALIFICATION')",
  "value": "number (optionnel)",
  "probability": "int 0-100 (optionnel)",
  "expectedCloseDate": "string ISO (optionnel)",
  "notes": "string (optionnel)"
}
```
Crée une `Opportunity` liée au lead, passe le lead en `CONVERTED`, déclenche `OPPORTUNITY_CREATED`. Erreur spécifique : `404 NOT_FOUND` si le lead n'existe pas.

**GET /pipeline/opportunities**
Query : `stage`, `assignedToId`, `companyId`, `pipelineId` (tous optionnels), `page` (défaut `'1'`), `limit` (défaut `'50'`). Réponse : `data` = opportunités (avec `contact`, `company`, `assignedTo`, `products.product`), `meta: { total, page, limit }`.

**POST /pipeline/opportunities**
```json
{
  "title": "string",
  "contactId": "string (optionnel)",
  "companyId": "string (optionnel)",
  "leadId": "string (optionnel)",
  "pipelineId": "string (optionnel — pipeline par défaut actif utilisé sinon)",
  "stage": "string (optionnel)",
  "value": "number (optionnel)",
  "probability": "int 0-100 (optionnel)",
  "expectedCloseDate": "string ISO (optionnel)",
  "assignedToId": "string (optionnel)",
  "notes": "string (optionnel)",
  "tags": "string ou null (optionnel)",
  "lostReason": "string (optionnel)",
  "remindAt": "string ISO ou null (optionnel)"
}
```
Si `pipelineId` absent, rattache au pipeline par défaut (ou premier pipeline actif) et corrige `stage` s'il n'existe pas dans ce pipeline. Réponse `201`. Déclenche `OPPORTUNITY_CREATED`.

**POST /pipeline/opportunities/reattach-orphans**
Pas de corps. Réponse : `{ reattached: number, pipeline: string }`. Erreur spécifique : `400 NO_PIPELINE` si aucun pipeline actif.

**GET /pipeline/opportunities/:id**
Réponse : opportunité avec `contact`, `company`, `assignedTo`, `products.product`, `activities` (20 dernières), `lead`. `404 NOT_FOUND` si absente.

**PUT /pipeline/opportunities/:id**
Corps identique à la création (`.partial()`). Si `stage` change réellement, `closedAt` est recalculé (daté si gagné/perdu, sinon `null`).

**PATCH /pipeline/opportunities/:id/stage**
```json
{
  "stage": "string",
  "lostReason": "string (optionnel)"
}
```
La clé `stage` doit correspondre à une étape existante (tous pipelines non-template confondus), sinon `400 INVALID_STAGE`. `404 NOT_FOUND` si l'opportunité n'existe pas. Si l'étape change, déclenche `OPPORTUNITY_STAGE_CHANGED` avec `previousStage`.

**DELETE /pipeline/opportunities/:id**
Réponse : `{ success: true, data: null }`.

---

### Pipelines `/api/pipelines`

Fichier : `server/src/routes/pipelines.ts`. Gère les pipelines (templates ADMIN + pipelines personnels) et leurs étapes.

Deux gardes supplémentaires, en plus de `requirePermission` :
- `requireAdmin` (routes `/templates*`) : exige `req.userRole === 'ADMIN'`, sinon `403 FORBIDDEN`.
- `canManagePipeline` (routes `/:id*` personnelles) : ADMIN passe toujours ; sinon exige `pipeline.ownerId === req.userId`, sinon `403 FORBIDDEN` (ou `404 NOT_FOUND` si le pipeline n'existe pas).

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/pipelines/templates` | Permission `pipeline:read` + Rôle ADMIN | Liste des templates de pipeline |
| POST | `/pipelines/templates` | Permission `pipeline:create` + Rôle ADMIN | Crée un template |
| PUT | `/pipelines/templates/:id` | Permission `pipeline:update` + Rôle ADMIN | Met à jour un template |
| PATCH | `/pipelines/templates/:id/default` | Permission `pipeline:update` + Rôle ADMIN | Définit ce template comme défaut |
| DELETE | `/pipelines/templates/:id` | Permission `pipeline:delete` + Rôle ADMIN | Supprime un template (interdit si défaut) |
| POST | `/pipelines/templates/:id/stages` | Permission `pipeline:create` + Rôle ADMIN | Ajoute une étape au template |
| PUT | `/pipelines/templates/:id/stages/:stageId` | Permission `pipeline:update` + Rôle ADMIN | Met à jour une étape du template |
| DELETE | `/pipelines/templates/:id/stages/:stageId` | Permission `pipeline:delete` + Rôle ADMIN | Supprime une étape du template |
| GET | `/pipelines` | Permission `pipeline:read` | Pipelines personnels de l'utilisateur + pipelines partagés legacy (`ownerId=null`) |
| POST | `/pipelines` | Permission `pipeline:create` | Crée un pipeline personnel |
| PATCH | `/pipelines/reorder` | Permission `pipeline:update` | Réordonne ses pipelines (ADMIN : tous les non-templates) |
| PUT | `/pipelines/:id` | Permission `pipeline:update` + propriétaire (ADMIN outrepasse) | Met à jour un pipeline |
| PATCH | `/pipelines/:id/default` | Permission `pipeline:update` + propriétaire (ADMIN outrepasse) | Définit ce pipeline comme défaut |
| DELETE | `/pipelines/:id` | Permission `pipeline:delete` + propriétaire (ADMIN outrepasse) | Désactive un pipeline (`isActive: false`, pas de suppression physique) |
| POST | `/pipelines/:id/stages` | Permission `pipeline:create` + propriétaire (ADMIN outrepasse) | Ajoute une étape |
| PUT | `/pipelines/:id/stages/:stageId` | Permission `pipeline:update` + propriétaire (ADMIN outrepasse) | Met à jour une étape |
| DELETE | `/pipelines/:id/stages/:stageId` | Permission `pipeline:delete` + propriétaire (ADMIN outrepasse) | Supprime une étape (si vide) |
| PATCH | `/pipelines/:id/stages/reorder` | Permission `pipeline:update` + propriétaire (ADMIN outrepasse) | Réordonne les étapes d'un pipeline |

Schéma commun pipeline (POST/PUT `/pipelines` et `/pipelines/templates`, `.partial()` en PUT) :
```json
{
  "name": "string",
  "description": "string (optionnel)",
  "color": "string (optionnel)",
  "order": "int (optionnel, auto-incrémenté sinon)"
}
```

Schéma commun étape (POST/PUT `.../stages`, `.partial()` en PUT) :
```json
{
  "key": "string",
  "name": "string",
  "color": "string (optionnel)",
  "order": "int (optionnel, auto-incrémenté sinon)",
  "isWon": "boolean (optionnel)",
  "isLost": "boolean (optionnel)"
}
```

**POST /pipelines/templates** et **POST /pipelines**
Créent respectivement un pipeline `isTemplate: true, ownerId: null` ou `isTemplate: false, ownerId: <userId>`. Appellent `ensureWonLostStages` (étapes Gagné/Perdu auto-créées). Réponse `201` avec `stages` incluses.

**POST /pipelines/templates/:id/stages** et **POST /pipelines/:id/stages**
`400 CONFLICT` si une étape avec la même `key` existe déjà pour ce pipeline.

**PUT/DELETE .../stages/:stageId**
`404 NOT_FOUND` si l'étape n'appartient pas au pipeline `:id`. `400 FORBIDDEN` si l'étape est `isWon`/`isLost` (non modifiable/supprimable). DELETE sur pipeline personnel : `400 CONFLICT` si des opportunités occupent encore cette étape.

**DELETE /pipelines/:id**
`404 NOT_FOUND` si absent. `400 FORBIDDEN` si c'est le pipeline par défaut. `400 CONFLICT` si des opportunités y sont rattachées. Sinon, désactivation logique (`isActive: false`).

**PATCH /pipelines/reorder**
```json
{ "pipelines": [{ "id": "string", "order": "int" }] }
```

**PATCH /pipelines/:id/stages/reorder**
```json
{ "stages": [{ "id": "string", "order": "int" }] }
```
Réponse : la liste des étapes mises à jour, triées par `order`.

---

### Objectifs & prévisions `/api/targets`

Fichier : `server/src/routes/targets.ts`. Le champ « réalisé » n'est jamais saisi manuellement : il est recalculé depuis les opportunités gagnées (`getWonLostStageKeys`).

`canReadAll(req)` = permission `*` ou `targets:read_all`. Sans elle, `GET /targets` et `GET /targets/forecast` sont automatiquement filtrés sur `req.userId`.

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/targets/periods` | Permission `targets:read` | Liste des périodes disponibles (8 trimestres passés + 4 futurs) |
| GET | `/targets/eligible-users` | Permission `targets:write` | Utilisateurs pouvant recevoir un objectif (ADMIN + rôles ayant `targets:read`) |
| GET | `/targets` | Permission `targets:read` | Objectifs de la période (siens seuls sans `targets:read_all`) |
| GET | `/targets/forecast` | Permission `targets:read` | Prévisions pondérées par étape/utilisateur pour une période |
| GET | `/targets/performance` | Permission `targets:read_all` | Classement des commerciaux (gagné/perdu/actif/winrate) |
| GET | `/targets/company` | Permission `company_targets:read` | Objectifs d'entreprise de la période (réalisé collectif + répartition) |
| POST | `/targets/company` | Permission `company_targets:write` | Crée ou met à jour (upsert) un objectif d'entreprise |
| PUT | `/targets/company/:id` | Permission `company_targets:write` | Met à jour un objectif d'entreprise |
| DELETE | `/targets/company/:id` | Permission `company_targets:write` | Supprime un objectif d'entreprise |
| POST | `/targets` | Permission `targets:write` | Crée ou met à jour (upsert) un objectif |
| PUT | `/targets/:id` | Permission `targets:write` | Met à jour un objectif |
| DELETE | `/targets/:id` | Permission `targets:write` | Supprime un objectif |

**GET /targets/periods**
Réponse : `data` = tableau de chaînes `"AAAA-Qn"` (ex. `["2024-Q3", ..., "2027-Q2"]`).

**GET /targets/eligible-users**
Réponse : `data` = utilisateurs actifs (`id, firstName, lastName, avatar, role`) qui sont `ADMIN` ou disposent de la permission `targets:read`.

**GET /targets**
Query : `period` (optionnel, défaut = trimestre courant, format `AAAA-Qn` ou `AAAA-MM`).
Réponse : `data` = objectifs (avec `user`, `pipeline`, et `computedActual` = somme des opportunités gagnées sur la période, filtrée par pipeline si l'objectif en a un), `meta: { period }`.

**GET /targets/forecast**
Query : `period` (optionnel, défaut trimestre courant), `pipelineId` (optionnel).
Réponse `data` :
```json
{
  "period": "string",
  "summary": { "weightedTotal": "number", "rawTotal": "number", "wonTotal": "number", "count": "number" },
  "byStage": [{ "stage": "string", "count": "number", "rawValue": "number", "weightedValue": "number", "stageName": "string", "stageColor": "string", "avgProba": "number" }],
  "byUser": [{ "userId": "string", "firstName": "string", "lastName": "string", "avatar": "string|null", "count": "number", "rawValue": "number", "weightedValue": "number", "wonValue": "number" }],
  "topOpportunities": [{ "id": "string", "title": "string", "value": "number", "probability": "number", "weighted": "number", "stage": "string", "expectedCloseDate": "date|null", "assignedTo": "object|null", "company": "object|null" }]
}
```

**GET /targets/performance**
Query : `period` (optionnel — sans valeur, agrège sur toute la durée). Réponse : `data` = tableau `{ user, wonCount, wonValue, lostCount, activeCount, createdCount, winRate, avgDeal }` pour les utilisateurs `COMMERCIAL`/`MANAGER`/`ADMIN` actifs ayant une activité, trié par `wonValue` décroissant.

**GET /targets/company**
Query : `period` (optionnel, défaut = trimestre courant ; formats `AAAA`, `AAAA-Qn` ou `AAAA-MM` — la période annuelle est acceptée ici, contrairement aux objectifs individuels).
Réponse : `data` = objectifs d'entreprise de la période (un global `pipelineId: null` et/ou un par pipeline), chacun enrichi de :
- `computedActual` : CA des opportunités gagnées de **tous** les commerciaux sur la période (filtré par pipeline si l'objectif en a un) ;
- `allocatedTarget` : somme des objectifs individuels couvrant la période sur le même périmètre, sans double comptage (l'objectif trimestriel d'un commercial prime sur ses objectifs mensuels du même trimestre ; pour une cible globale, l'objectif individuel global prime sur les ventilations par pipeline).

**POST /targets/company**
```json
{
  "period": "string (format 2026, 2026-Q1 ou 2026-01)",
  "target": "number positif",
  "pipelineId": "string ou null (optionnel — absent/null = objectif global)"
}
```
Upsert sur `(period, pipelineId)` : met à jour l'objectif d'entreprise existant ou en crée un. Réponse `201`.

**PUT /targets/company/:id**
```json
{
  "target": "number positif",
  "pipelineId": "string ou null (optionnel)"
}
```

**POST /targets**
```json
{
  "userId": "string",
  "period": "string (format 2026-Q1 ou 2026-01)",
  "target": "number positif",
  "pipelineId": "string ou null (optionnel — absent/null = objectif global)"
}
```
Upsert sur `(userId, period, pipelineId)` : met à jour l'objectif existant ou en crée un. Réponse `201`.

**PUT /targets/:id**
```json
{
  "target": "number positif",
  "pipelineId": "string ou null (optionnel)"
}
```

---

### Automatisations `/api/automations`

Fichier : `server/src/routes/automations.ts`.

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/automations` | Permission `automation:read` | Liste des automatisations, enrichies (compteurs succès/échec, dernière exécution) |
| POST | `/automations` | Permission `automation:create` | Crée une automatisation |
| GET | `/automations/:id/logs` | Permission `automation:read` | 50 derniers logs d'exécution |
| PUT | `/automations/:id` | Permission `automation:update` | Met à jour une automatisation (partiel) |
| PATCH | `/automations/:id` | Permission `automation:update` | Active/désactive une automatisation |
| DELETE | `/automations/:id` | Permission `automation:delete` | Supprime une automatisation |

**GET /automations**
Réponse : `data` = automatisations avec `successCount`, `errorCount`, `lastRunAt` (calculés depuis `AutomationLog`).

**POST /automations** et **PUT /automations/:id** (`.partial()`)
```json
{
  "name": "string",
  "description": "string (optionnel)",
  "trigger": "string",
  "conditions": "string JSON (optionnel, défaut '{}')",
  "actions": "string JSON (min 2 caractères — au moins une action requise)",
  "isActive": "boolean (optionnel, défaut true)"
}
```
Réponse POST : `201`.

**GET /automations/:id/logs**
Réponse : `data` = 50 derniers `AutomationLog` (avec `user.firstName/lastName`), triés par date décroissante.

**PATCH /automations/:id**
```json
{ "isActive": "boolean" }
```

---

### Tickets `/api/tickets`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/tickets` | Permission `tickets:read` | Liste paginée des tickets, filtrable |
| POST | `/tickets` | Permission `tickets:create` | Création d'un ticket |
| GET | `/tickets/export/csv` | Permission `tickets:export` | Export CSV des tickets (mêmes filtres que la liste) |
| GET | `/tickets/:id` | Permission `tickets:read` | Détail d'un ticket (+ rendez-vous liés) |
| PUT | `/tickets/:id` | Permission `tickets:update` | Mise à jour partielle |
| PATCH | `/tickets/:id/status` | Permission `tickets:update` | Changement de statut (+ temps passé optionnel) |
| POST | `/tickets/:id/comments` | Permission `tickets:update` | Ajout d'un commentaire |
| PATCH | `/tickets/:id/time` | Permission `tickets:update` | Ajout de temps passé (crée une `TicketTimeEntry`) |
| POST | `/tickets/:id/attachments` | Permission `tickets:update` | Upload d'une pièce jointe (`multipart/form-data`) |
| GET | `/tickets/attachments/:attachmentId/download` | Permission `tickets:read` | Téléchargement d'une pièce jointe |
| DELETE | `/tickets/attachments/:attachmentId` | Permission `tickets:update` | Suppression d'une pièce jointe |
| DELETE | `/tickets/:id` | Permission `tickets:delete` | Suppression d'un ticket (+ fichiers joints sur disque) |

**GET /tickets** — Query : `page` (défaut 1), `limit` (défaut 25, max 100), `sortBy` (`createdAt`\|`updatedAt`\|`priority`\|`status`\|`timeSpent`\|`reference`\|`slaDeadline`, sinon tri par défaut `priorityOrder desc, createdAt desc`), `sortOrder` (`asc`\|`desc`, défaut `desc`), `search` (titre/référence/description), `priority`, `category`, `assignedToId`, `companyId`, `status` (répétable : `?status=NEW&status=IN_PROGRESS`).
Réponse : tableau de tickets (avec `contact`, `company`, `assignedTo`, `equipment`, `_count.comments`, `_count.attachments`) + `meta.total/page/limit`.

**POST /tickets**
```json
{
  "title": "string",
  "description": "string",
  "category": "string",
  "priority": "LOW | NORMAL | HIGH | CRITICAL (optionnel)",
  "contactId": "string | null (optionnel)",
  "companyId": "string | null (optionnel)",
  "contractId": "string | null (optionnel)",
  "equipmentId": "string | null (optionnel)",
  "assignedToId": "string | null (optionnel)",
  "callId": "string | null (optionnel)",
  "notes": "string | null (optionnel)"
}
```
Réponse (201) : le ticket créé. Génère une référence unique (retry automatique en cas de collision), calcule `slaDeadline` selon la priorité, journalise un événement `CREATED`, notifie l'assigné, alerte les managers si `priority: CRITICAL`, déclenche l'automatisation `TICKET_CREATED`.
Erreur spécifique : si `assignedToId` désigne quelqu'un d'autre que l'auteur de la requête et que celui-ci n'a pas la permission `tickets:assign` → 403 `FORBIDDEN`.

**GET /tickets/export/csv** — Mêmes filtres query que la liste (hors pagination/tri). Réponse : `text/csv; charset=utf-8` avec BOM UTF-8, colonnes Référence/Titre/Statut/Priorité/Catégorie/Contact/Entreprise/Assigné à/Temps (min)/Créé le.

**GET /tickets/:id** — Réponse : ticket complet (`contact`, `company`, `contract`, `equipment`, `assignedTo`, `createdBy`, `comments`, `events`, `timeEntries`, `attachments`, `npsResponse`) + `appointments` (rendez-vous liés via `Appointment.ticketId`, non typés comme relation Prisma côté Ticket). 404 `NOT_FOUND` si absent.

**PUT /tickets/:id** — Corps : `ticketSchema` en version partielle (tous les champs ci-dessus optionnels). Mêmes règles d'accès sur `assignedToId` que la création, à l'exception de : sans `tickets:assign`, un utilisateur peut toujours se prendre le ticket (`assignedToId = soi-même`) ou se désassigner soi-même. Si un ticket `NEW` reçoit une nouvelle assignation, son statut bascule automatiquement en `IN_PROGRESS`. Si `priority` change, `priorityOrder` et `slaDeadline` sont recalculés (ancrés sur la date de création d'origine). Journalise les événements `PRIORITY_CHANGED` / `STATUS_CHANGED` / `ASSIGNED` / `UNASSIGNED` selon les champs modifiés. 404 si le ticket n'existe pas, 403 `FORBIDDEN` sur assignation non autorisée.

**PATCH /tickets/:id/status**
```json
{
  "status": "NEW | IN_PROGRESS | WAITING_CLIENT | RESOLVED | CLOSED",
  "timeSpent": "integer >= 0 (optionnel)"
}
```
Réponse : ticket mis à jour. Idempotent : si le statut soumis est identique au statut actuel et `timeSpent` absent, renvoie le ticket sans effet de bord (pas d'événement, pas d'email, pas d'automatisation). Sinon journalise `STATUS_CHANGED` (ou `REOPENED` si la transition rouvre le ticket, cf. `statusTransitionData`), déclenche l'automatisation `TICKET_RESOLVED` si le nouveau statut est `RESOLVED`/`CLOSED`, et envoie un email de clôture + lien d'enquête NPS si le nouveau statut est `CLOSED` et que le contact a un email (best-effort, n'échoue pas la requête). 404 si ticket introuvable.

**POST /tickets/:id/comments**
```json
{
  "content": "string (non vide)",
  "isInternal": "boolean, ou \"true\"/\"false\" (optionnel, défaut false)"
}
```
Réponse (201) : le commentaire créé. L'auteur (`authorName`) est résolu depuis l'utilisateur authentifié, jamais depuis le corps envoyé. Notifie l'assigné du ticket (sauf si c'est l'auteur du commentaire). 404 si ticket introuvable.

**PATCH /tickets/:id/time**
```json
{
  "minutes": "integer, 1 à 1440",
  "note": "string, max 500 caractères (optionnel)"
}
```
Réponse : le ticket mis à jour (`timeSpent` incrémenté). Crée aussi une `TicketTimeEntry` détaillée et un événement `TIME_ADDED`. 404 si ticket introuvable.

**POST /tickets/:id/attachments** — `multipart/form-data`, champ **`file`** obligatoire. Types autorisés : images (png/jpeg/gif/webp), PDF, txt, csv, log, doc/docx, xls/xlsx, zip. Taille max 10 Mo. Réponse (201) : la pièce jointe créée. Erreurs spécifiques : 400 `INVALID_FILE_TYPE` (type non autorisé), 400 `UPLOAD_ERROR` (fichier trop volumineux ou autre erreur multer), 400 `VALIDATION_ERROR` (aucun fichier reçu), 404 `NOT_FOUND` (ticket introuvable — le fichier déjà uploadé est alors supprimé du disque).

**GET /tickets/attachments/:attachmentId/download** — Réponse : flux binaire (`res.download`, nom de fichier d'origine restauré). 404 `NOT_FOUND` si la pièce jointe n'existe pas en base ou si le fichier est absent du stockage disque.

**DELETE /tickets/attachments/:attachmentId** — Supprime l'entrée en base et le fichier sur disque (best-effort). Réponse : `{ "message": "Pièce jointe supprimée" }`. 404 si introuvable.

**DELETE /tickets/:id** — Supprime le ticket (cascade DB sur les lignes liées) et nettoie les fichiers de pièces jointes sur disque. Réponse : `{ "message": "Ticket supprimé" }`.

---

### NPS (enquête de satisfaction) `/api/nps`

Module **public**, sans authentification. Accès protégé uniquement par un jeton HMAC signé (`verifyNpsToken`), lié à un ticket et expirant. Rate-limité globalement à 30 requêtes / 15 min sur tout le préfixe `/api/nps` (middleware appliqué avant les routes dans `app.ts`).

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/nps/:token` | Public (jeton signé) | Infos minimales du ticket pour afficher la page de notation |
| POST | `/nps/:token` | Public (jeton signé) | Enregistre la réponse NPS (une seule par ticket) |

**GET /nps/:token** — Réponse : `{ "reference": "string", "title": "string", "alreadyAnswered": "boolean" }`. Erreurs : 404 `INVALID_TOKEN` (jeton invalide/expiré), 404 `NOT_FOUND` (ticket introuvable).

**POST /nps/:token**
```json
{
  "score": "integer, 0 à 10",
  "comment": "string, max 1000 caractères (optionnel)"
}
```
Réponse (201) : `{ "score": number }`. Journalise l'événement `NPS_RECEIVED` sur le ticket et notifie l'assigné. Erreurs : 404 `INVALID_TOKEN`, 404 `NOT_FOUND`, 409 `ALREADY_ANSWERED` (contrainte d'unicité `ticketId` déjà répondue), 400 `VALIDATION_ERROR`.

---

### Base de connaissances `/api/knowledge`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/knowledge/categories` | Permission `knowledge:read` | Compteurs d'articles par catégorie |
| GET | `/knowledge` | Permission `knowledge:read` | Liste paginée des articles |
| POST | `/knowledge` | Permission `knowledge:create` | Création d'un article |
| GET | `/knowledge/:id` | Permission `knowledge:read` | Détail d'un article (incrémente `views`) |
| PUT | `/knowledge/:id` | Permission `knowledge:update` | Mise à jour partielle |
| DELETE | `/knowledge/:id` | Permission `knowledge:delete` | Suppression d'un article |

Sur `GET /knowledge/categories` et `GET /knowledge`, les articles non publiés (`isPublished: false`) sont exclus sauf si l'appelant a la permission `knowledge:update` (ou `*`) — considéré « éditeur ».

**GET /knowledge** — Query : `search` (titre/contenu/tags), `category`, `page` (défaut 1), `limit` (défaut 25, max 100).
Réponse : tableau d'articles + `meta.total/page/limit`.

**POST /knowledge**
```json
{
  "title": "string (non vide)",
  "content": "string (non vide)",
  "category": "string",
  "tags": "string (optionnel)",
  "isPublished": "boolean (optionnel)"
}
```
Réponse (201) : l'article créé.

**GET /knowledge/:id** — Réponse : l'article. 404 `NOT_FOUND` si absent. Effet de bord : `views` est incrémenté à chaque lecture.

**PUT /knowledge/:id** — Corps : schéma ci-dessus en version partielle. Réponse : l'article mis à jour.

**DELETE /knowledge/:id** — Réponse : `{ "message": "Article supprimé" }`.

---

### Équipements `/api/equipment`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/equipment` | Permission `equipment:read` | Liste paginée des équipements |
| POST | `/equipment` | Permission `equipment:create` | Création d'un équipement |
| GET | `/equipment/:id` | Permission `equipment:read` | Détail (+ 10 derniers tickets, licences) |
| PUT | `/equipment/:id` | Permission `equipment:update` | Mise à jour partielle |
| DELETE | `/equipment/:id` | Permission `equipment:delete` | Suppression |

**GET /equipment** — Query : `companyId`, `type`, `status`, `warrantyExpiringSoon` (`"true"` → garantie expirant entre aujourd'hui et +90 jours), `page` (défaut 1), `limit` (défaut 50, max 200).
Réponse : tableau d'équipements (`company`, `contract`, `product`, `_count.tickets/licenses`) + `meta`.

**POST /equipment**
```json
{
  "companyId": "string",
  "contractId": "string (optionnel)",
  "productId": "string (optionnel)",
  "type": "string",
  "brand": "string (optionnel)",
  "model": "string (optionnel)",
  "serialNumber": "string (optionnel)",
  "purchaseDate": "string ISO date (optionnel)",
  "warrantyExpiry": "string ISO date (optionnel)",
  "location": "string (optionnel)",
  "status": "string (optionnel)",
  "notes": "string (optionnel)"
}
```
Réponse (201) : l'équipement créé. Une chaîne vide pour `productId`/`contractId` est convertie en `NULL` (au lieu de violer la contrainte de clé étrangère).

**GET /equipment/:id** — Réponse : équipement complet (`company`, `contract`, 10 derniers `tickets`, `licenses`). 404 `NOT_FOUND` si absent.

**PUT /equipment/:id** — Corps : schéma ci-dessus en version partielle. Mêmes règles de normalisation des FK vides → `NULL`. Réponse : l'équipement mis à jour.

**DELETE /equipment/:id** — Réponse : `{ "message": "Équipement supprimé" }`.

---

### Parc `/api/parc`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/parc/overview` | Permission `equipment:read` | Vue d'ensemble par entreprise (équipements, licences, contrats, alertes) |

**GET /parc/overview** — Sans paramètre query. Réponse : tableau des entreprises actives ayant au moins un équipement, une licence ou un contrat, triées par nombre d'alertes décroissant puis nom (`fr`) :
```json
[
  {
    "id": "string",
    "name": "string",
    "city": "string | null",
    "sector": "string | null",
    "equipmentCount": "number",
    "licenseCount": "number",
    "contractCount": "number",
    "activeContracts": "number",
    "warrantyExpired": "number",
    "warrantyExpiring": "number",
    "licenseExpired": "number",
    "licenseExpiring": "number",
    "alertCount": "number"
  }
]
```
« Expirant » = échéance dans les 60 jours (`ALERT_DAYS = 60`). Seuls les équipements `status: ACTIVE` sont comptés pour la garantie.

---

### Licences `/api/licenses`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/licenses` | Permission `equipment:read` | Liste paginée des licences |
| POST | `/licenses` | Permission `equipment:create` | Création d'une licence |
| PUT | `/licenses/:id` | Permission `equipment:update` | Mise à jour partielle |
| DELETE | `/licenses/:id` | Permission `equipment:delete` | Suppression |

Note : le module réutilise les permissions `equipment:*` (aucune permission `licenses:*` dédiée), et **il n'existe pas de route `GET /licenses/:id`** (pas de détail unitaire, seulement liste/création/modification/suppression).

**GET /licenses** — Query : `companyId`, `type`, `expiringSoon` (`"true"` → expiration entre aujourd'hui et +60 jours), `page` (défaut 1), `limit` (défaut 50, max 200). Réponse : tableau de licences (`company`, `equipment`, `product`) + `meta`, triées par `expiryDate asc`.

**POST /licenses**
```json
{
  "companyId": "string",
  "equipmentId": "string (optionnel)",
  "productId": "string (optionnel)",
  "software": "string (non vide)",
  "vendor": "string (optionnel)",
  "licenseKey": "string (optionnel)",
  "seats": "integer (optionnel)",
  "type": "string (optionnel)",
  "purchaseDate": "string ISO date (optionnel)",
  "expiryDate": "string ISO date (optionnel)",
  "cost": "number (optionnel)",
  "notes": "string (optionnel)"
}
```
Réponse (201) : la licence créée. FK vides (`productId`/`equipmentId`) normalisées en `NULL`.

**PUT /licenses/:id** — Corps : schéma ci-dessus en version partielle, mêmes règles FK. Réponse : la licence mise à jour.

**DELETE /licenses/:id** — Réponse : `{ "message": "Licence supprimée" }`.

---

### Contrats `/api/contracts`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/contracts` | Permission `contracts:read` | Liste paginée des contrats |
| POST | `/contracts` | Permission `contracts:create` | Création d'un contrat |
| GET | `/contracts/:id` | Permission `contracts:read` | Détail (lignes, tickets, équipements, alertes de renouvellement) |
| PUT | `/contracts/:id` | Permission `contracts:update` | Mise à jour partielle |
| DELETE | `/contracts/:id` | Permission `contracts:delete` | Suppression |
| GET | `/contracts/stats/mrr` | Permission `contracts:read` | Statistiques MRR / ARR des contrats actifs |

**GET /contracts** — Query : `status`, `type`, `companyId`, `expiringSoon` (`"true"` → `endDate` dans les 60 jours **et** force `status = ACTIVE`, écrasant tout `status` passé en query), `page` (défaut 1), `limit` (défaut 25, max 100). Réponse : tableau de contrats (`company`, `_count.tickets/equipments`) + `meta`, triés par `endDate asc`.

**POST /contracts**
```json
{
  "companyId": "string",
  "type": "string",
  "title": "string (non vide)",
  "description": "string (optionnel)",
  "status": "string (optionnel)",
  "startDate": "string ISO date",
  "endDate": "string ISO date",
  "renewalDate": "string ISO date (optionnel)",
  "monthlyAmount": "number (optionnel)",
  "annualAmount": "number (optionnel)",
  "slaResponseTime": "integer (optionnel)",
  "slaWorkingHours": "string (optionnel)",
  "autoRenewal": "boolean (optionnel)",
  "notes": "string (optionnel)"
}
```
Réponse (201) : le contrat créé, avec référence auto-générée au format `CTR-<année>-<0001>`.

**GET /contracts/:id** — Réponse : contrat complet (`company`, `lines.product`, 10 derniers `tickets`, `equipments`, `renewalAlerts`). 404 `NOT_FOUND` si absent.

**PUT /contracts/:id** — Corps : schéma ci-dessus en version partielle (`startDate`/`endDate` deviennent optionnels via `.partial()`). Réponse : le contrat mis à jour.

**DELETE /contracts/:id** — Réponse : `{ "message": "Contrat supprimé" }`.

**GET /contracts/stats/mrr** — Sans paramètre. Réponse :
```json
{
  "mrr": "number (arrondi 2 décimales)",
  "arr": "number (mrr * 12, arrondi 2 décimales)",
  "byType": { "<type>": "number" },
  "total": "number (nombre de contrats actifs)"
}
```
Calcul sur les contrats `status: ACTIVE` uniquement, `monthlyAmount` prioritaire sur `annualAmount / 12`.

---

### Produits `/api/products`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/products` | Permission `products:read` | Liste paginée des produits |
| POST | `/products` | Permission `products:create` | Création d'un produit |
| GET | `/products/:id` | Permission `products:read` | Détail d'un produit |
| PUT | `/products/:id` | Permission `products:update` | Mise à jour partielle |
| DELETE | `/products/:id` | Permission `products:delete` | Désactivation (soft delete) |

**GET /products** — Query : `search` (nom/référence/fournisseur), `category`, `type`, `page` (défaut 1), `limit` (défaut 50, max 200). Réponse : tableau de produits + `meta`, triés par `name asc`.

**POST /products**
```json
{
  "reference": "string (optionnel)",
  "name": "string (non vide)",
  "description": "string (optionnel)",
  "category": "string",
  "type": "string (optionnel)",
  "price": "number",
  "vatRate": "number (optionnel)",
  "unit": "string (optionnel)",
  "stock": "integer (optionnel)",
  "supplier": "string (optionnel)",
  "imageUrl": "string (optionnel)",
  "isActive": "boolean (optionnel)"
}
```
Réponse (201) : le produit créé.

**GET /products/:id** — Réponse : le produit. 404 `NOT_FOUND` si absent.

**PUT /products/:id** — Corps : schéma ci-dessus en version partielle. Réponse : le produit mis à jour.

**DELETE /products/:id** — N'effectue **pas** de suppression réelle en base : met à jour `isActive: false` (soft delete). Réponse : `{ "message": "Produit désactivé" }`.

---

### Appels `/api/calls`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| POST | `/calls/webhook` | Webhook (secret `X-Webhook-Secret`) | Réception d'un événement d'appel VoIP externe, upsert par `call_id` |
| GET | `/calls` | Permission `calls:read` | Liste paginée des appels (filtres + recherche) |
| GET | `/calls/:id` | Permission `calls:read` | Détail d'un appel |
| POST | `/calls` | Permission `calls:create` | Création manuelle d'un appel |
| PUT | `/calls/:id` | Permission `calls:update` | Mise à jour d'un appel |
| DELETE | `/calls/:id` | Permission `calls:delete` | Suppression d'un appel (+ fichier d'enregistrement local) |
| POST | `/calls/sync-ovh` | Permission `calls:create` | Synchronisation manuelle immédiate avec OVH VoIP |
| GET | `/calls/sync-ovh/debug` | Rôle ADMIN | Diagnostic OVH (CDR bruts 24h + fiches en base) |
| POST | `/calls/:id/recording` | Permission `calls:listen` | Upload d'un fichier d'enregistrement (multipart, max 50 Mo) |
| GET | `/calls/:id/recording/stream` | Permission `calls:listen` | Streaming (Range) ou redirection vers l'enregistrement |

**POST /calls/webhook**
En-tête requis : `X-Webhook-Secret` (comparé en temps constant à `VOIP_WEBHOOK_SECRET`).
```json
{
  "call_id": "string (optionnel — sert de externalId pour upsert)",
  "direction": "INBOUND | OUTBOUND (optionnel, défaut INBOUND)",
  "status": "ANSWERED | MISSED | VOICEMAIL | IN_PROGRESS (optionnel, défaut ANSWERED)",
  "caller_number": "string (obligatoire)",
  "caller_name": "string (optionnel)",
  "receiver_number": "string (optionnel)",
  "started_at": "string ISO (optionnel, défaut: maintenant)",
  "answered_at": "string ISO (optionnel)",
  "ended_at": "string ISO (optionnel)",
  "duration": "number (optionnel, secondes)",
  "recording_url": "string, URL https (optionnel)"
}
```
Réponse : l'appel créé, ou mis à jour si `call_id` correspond à un `externalId` existant. Le contact/l'entreprise sont auto-détectés par numéro de téléphone normalisé (égalité stricte sur `phoneNormalized`/`mobileNormalized`).
Erreurs spécifiques : `503 WEBHOOK_DISABLED` (secret non configuré côté serveur), `401 INVALID_WEBHOOK_SECRET` (en-tête manquant ou invalide), `400 INVALID_RECORDING_URL` (`recording_url` non-https ou invalide).

**GET /calls**
Query : `search`, `status` (`ANSWERED|MISSED|VOICEMAIL|IN_PROGRESS`), `direction` (`INBOUND|OUTBOUND`), `category`, `assignedToId`, `companyId`, `contactId`, `dateFrom`, `dateTo` (bornes sur `startedAt`, `dateTo` interprété jusqu'à 23:59:59), `page` (défaut 1), `limit` (défaut 25, max 100).
Réponse : `data` = liste d'appels (avec `contact`, `company`, `assignedTo`, `_count.tickets`), `meta: { total, page, limit }`.

**GET /calls/:id**
Réponse : l'appel avec `contact` (incl. `phone`/`mobile`), `company`, `assignedTo`, `tickets`. Erreur : `404 NOT_FOUND`.

**POST /calls**
```json
{
  "direction": "INBOUND | OUTBOUND (optionnel, défaut INBOUND)",
  "status": "ANSWERED | MISSED | VOICEMAIL | IN_PROGRESS (optionnel, défaut ANSWERED)",
  "callerNumber": "string (obligatoire)",
  "callerName": "string (optionnel)",
  "receiverNumber": "string (optionnel)",
  "startedAt": "string ISO (optionnel, défaut: maintenant)",
  "answeredAt": "string ISO (optionnel)",
  "endedAt": "string ISO (optionnel)",
  "duration": "number (optionnel)",
  "category": "string (optionnel)",
  "priority": "string (optionnel, défaut NORMAL)",
  "notes": "string (optionnel)",
  "isHandled": "boolean (optionnel — accepté par le schéma mais non écrit en base à la création, voir anomalies)",
  "contactId": "string (optionnel)",
  "companyId": "string (optionnel)",
  "assignedToId": "string (optionnel)"
}
```
Réponse `201` : l'appel créé (avec `contact`, `company`, `assignedTo`).

**PUT /calls/:id**
Même schéma que POST, tous champs optionnels (`.partial()`). Réponse : l'appel mis à jour (avec `contact`, `company`, `assignedTo`, `tickets`).

**POST /calls/sync-ovh**
Pas de corps. Déclenche immédiatement une synchronisation OVH VoIP (le scheduler tourne déjà toutes les 5 min). Réponse : `data` = statistiques de synchro (objet retourné par `runOvhVoipSync`). Erreurs : `503 OVH_DISABLED` (clés API OVH absentes côté serveur), `502 OVH_SYNC_FAILED`.

**GET /calls/sync-ovh/debug**
Réponse : `data` = rapport de diagnostic OVH. Erreur : `502 OVH_DEBUG_FAILED`.

**POST /calls/:id/recording**
`multipart/form-data`, champ `recording` (fichier audio : `.mp3`, `.wav`, `.ogg`, `.m4a`, `.mp4`, `.webm` ; max 50 Mo). L'ancien fichier local est supprimé s'il existait. Réponse : l'appel mis à jour (`recordingPath`). Erreurs : `400 INVALID_FILE_TYPE`, `400 FILE_TOO_LARGE`, `400 UPLOAD_ERROR`, `400 NO_FILE`.

**GET /calls/:id/recording/stream**
Sert le fichier local en streaming avec support `Range` (`206 Partial Content`), sinon redirige (`302`) vers `recordingUrl` si celle-ci est en https. Erreurs : `404 NOT_FOUND` (appel introuvable), `404 NO_RECORDING` (aucun fichier ni URL exploitable).

---

### Google Calendar `/api/google`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| POST | `/google/notifications` | Public (vérifié par jeton de canal Google) | Réception des push notifications Google Calendar |
| GET | `/google/status` | Authentifié | Statut de connexion Calendar de l'utilisateur courant |
| GET | `/google/calendar/connect` | Authentifié | Génère l'URL de consentement OAuth Google (scopes Calendar) |
| GET | `/google/calendar/callback` | Public (state CSRF signé + cookie) | Échange le code OAuth, stocke le refresh token, redirige vers le front |
| POST | `/google/calendar/disconnect` | Authentifié | Révoque et supprime la connexion Google Calendar |
| POST | `/google/calendar/sync` | Authentifié | Synchronisation manuelle forcée (pull) |
| POST | `/google/calendar/sync/all` | Authentifié + Rôle ADMIN | Synchronisation globale de tous les utilisateurs connectés |

**POST /google/notifications**
Pas de corps JSON (Google POST sans payload d'événement). Informations portées par les en-têtes : `X-Goog-Channel-Id`, `X-Goog-Resource-Id`, `X-Goog-Resource-State`, `X-Goog-Channel-Token`. Répond `200` immédiatement puis déclenche la synchro en arrière-plan (garde-fou anti-rafale via `inFlight`). Erreur : `403 INVALID_CHANNEL_TOKEN` (jeton de canal invalide — possible usurpation).

**GET /google/status**
```json
{
  "connected": "boolean",
  "googleEmail": "string | null",
  "calendarSyncEnabled": "boolean",
  "lastSyncAt": "string | null",
  "watchChannel": {
    "channelId": "string",
    "expiresAt": "string | null",
    "active": "boolean"
  }
}
```
`watchChannel` est `null` si aucun canal n'a été ouvert.

**GET /google/calendar/connect**
Réponse : `data: { "url": "string" }` (URL de consentement Google). Pose un cookie httpOnly `gcal_state` (JWT signé 5 min, secret dérivé de `JWT_SECRET`). Erreur : `503 GOOGLE_DISABLED` (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` absents).

**GET /google/calendar/callback**
Query : `code`, `state`, `error` (optionnel, renvoyé par Google en cas de refus). Ne renvoie pas de JSON en cas de succès : redirige vers `${FRONTEND_URL}/appointments?google=connected|error|no_refresh_token`. Erreurs renvoyées en JSON (avant toute redirection) : `503 GOOGLE_DISABLED`, `400 INVALID_STATE` (state CSRF manquant, ne correspondant pas au cookie, ou JWT expiré/invalide).

**POST /google/calendar/disconnect**
Pas de corps. Réponse : `data: { "message": "string" }`. Effets : fermeture du canal watch (best-effort), révocation du refresh token chez Google (best-effort), suppression des `AppointmentGoogleEvent` de l'utilisateur, suppression de la credential.

**POST /google/calendar/sync**
Pas de corps. Réponse : `data: { "pulled": number, "pushed": 0, "errors": 0 }` (`pushed`/`errors` toujours à 0, voir anomalies). Erreur : `400 NOT_CONNECTED` (pas de credential ou synchro désactivée).

**POST /google/calendar/sync/all**
Réservé aux `ADMIN` (vérification manuelle de `req.userRole`, pas via le middleware `requireRole`). Réponse : `data` = statistiques globales (objet retourné par `runCalendarSync(true)`). Erreur : `403 FORBIDDEN`.

---

### Partages de calendrier `/api/calendar-access`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/calendar-access` | Permission `calendars:manage_access` | Liste tous les partages de calendrier |
| GET | `/calendar-access/mine` | Authentifié | Calendriers (utilisateurs) visibles par l'appelant |
| POST | `/calendar-access` | Permission `calendars:manage_access` | Crée (ou réactive) un partage de calendrier |
| DELETE | `/calendar-access/:viewerId/:ownerId` | Permission `calendars:manage_access` | Supprime un partage de calendrier |

**GET /calendar-access**
Réponse : `data` = liste de
```json
{
  "viewerId": "string",
  "ownerId": "string",
  "createdAt": "string",
  "viewer": { "id": "string", "firstName": "string", "lastName": "string", "email": "string", "avatar": "string | null" },
  "owner": { "...": "idem viewer" }
}
```

**GET /calendar-access/mine**
Réponse (forme non standard — `isAll` au niveau racine, hors de `data`, voir anomalies) :
```json
{
  "success": true,
  "data": [ { "id": "string", "firstName": "string", "lastName": "string", "avatar": "string | null" } ],
  "isAll": "boolean"
}
```
Si l'appelant est ADMIN (visibilité `'all'`) : tous les utilisateurs actifs, `isAll: true`. Sinon : les propriétaires de calendrier visibles (l'appelant lui-même en premier), `isAll: false`.

**POST /calendar-access**
```json
{
  "viewerId": "string, uuid (obligatoire)",
  "ownerId": "string, uuid (obligatoire)"
}
```
Idempotent (upsert sur la clé composite `viewerId_ownerId`). Réponse `201` : le partage `{ viewerId, ownerId, createdAt }`. Erreurs : `400 INVALID_PARAMS` (`viewerId === ownerId`), `400 NOT_FOUND` (viewer ou owner introuvable — code `NOT_FOUND` renvoyé avec le statut `400`, voir anomalies).

**DELETE /calendar-access/:viewerId/:ownerId**
Paramètres d'URL : `viewerId`, `ownerId`. Réponse : `data: { "message": "string" }`. Erreur : `404 NOT_FOUND`.

---

### Rendez-vous `/api/appointments`

| Méthode | Route | Accès | Description |
|---------|-------|-------|-------------|
| GET | `/appointments` | Permission `appointments:read` | Liste des RDV visibles par l'appelant (filtres période/participant/calendrier) |
| POST | `/appointments` | Permission `appointments:create` | Création d'un RDV (notifications + push Google) |
| GET | `/appointments/:id` | Permission `appointments:read` | Détail d'un RDV |
| PUT | `/appointments/:id` | Permission `appointments:update` | Mise à jour d'un RDV |
| DELETE | `/appointments/:id` | Permission `appointments:delete` | Suppression d'un RDV (+ copies Google des participants) |

**GET /appointments**
Query : `from`, `to` (ISO, filtrent `startAt`), `userId` (legacy — filtre par participant), `ownerId` (filtre le calendrier d'un utilisateur ; nécessite que l'appelant ait la visibilité sur ce calendrier, sinon `403 CALENDAR_FORBIDDEN`). Réponse : `data` = liste de RDV (`users` avec `user{id,firstName,lastName,avatar}`, `contacts` avec `contact{id,firstName,lastName}`), restreinte à la visibilité calendrier de l'appelant.

**POST /appointments**
```json
{
  "title": "string (obligatoire)",
  "description": "string (optionnel)",
  "type": "string (obligatoire)",
  "startAt": "string ISO (obligatoire)",
  "endAt": "string ISO (obligatoire)",
  "location": "string (optionnel)",
  "ticketId": "string (optionnel)",
  "notes": "string (optionnel)",
  "userIds": ["string"],
  "contactIds": ["string"]
}
```
Réponse `201` : le RDV créé (avec `users`, `contacts`). Effets de bord : notification DB (`APPOINTMENT_CREATED`) pour chaque participant hors créateur, push Google Calendar fire-and-forget vers tous les participants (`pushAppointmentToAll`).

**GET /appointments/:id**
Réponse : le RDV (avec `users`, `contacts`). Erreur : `404 NOT_FOUND` — renvoyé aussi bien si le RDV n'existe pas que s'il existe mais n'est pas visible par l'appelant (volontairement, pour ne pas révéler l'existence de la ressource).

**PUT /appointments/:id**
Même schéma que POST, tous champs optionnels (`.partial()`). Si `userIds`/`contactIds` sont fournis, remplacent intégralement les participants/contacts existants (`deleteMany` + `create`). Réponse : le RDV mis à jour — **sans** `include` sur `users`/`contacts` (incohérent avec POST/GET, voir anomalies). Effets de bord : suppression des copies Google des participants retirés (`pushRemovedParticipants`), push Google vers les participants courants (`pushAppointmentToAll`). Erreur : `404 NOT_FOUND` (idem GET).

**DELETE /appointments/:id**
Réponse : `data: { "message": "string" }`. Avant suppression, supprime (best-effort, attendu) les copies Google Calendar de chaque participant, car la suppression du RDV efface en cascade les liens `AppointmentGoogleEvent`. Erreur : `404 NOT_FOUND` (idem GET).
