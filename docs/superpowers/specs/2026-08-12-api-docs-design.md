# Documentation API consultable et téléchargeable — Design

**Date** : 2026-08-12
**Statut** : approuvé (approche A)

## Objectif

Fournir une documentation complète de l'API DCRM :
1. **Consultable** dans le CRM via une page dédiée « Documentation API »
2. **Téléchargeable** en deux formats : `API.md` (Markdown, destiné aux IA) et `openapi.json` (OpenAPI 3, destiné aux outils type Postman/n8n)
3. **Accès géré** par le système de permissions existant (nouvelle permission `apidocs:read`, ADMIN par défaut, modifiable dans la page Rôles)

## Approche retenue

Docs **statiques versionnées** dans le repo, régénérées depuis le code réel des routes, servies par l'API derrière la permission. (Alternatives rejetées : introspection runtime — trop squelettique ; annotations tsoa — refactor trop lourd.)

## Composants

### 1. Contenu documentaire (source de vérité)
- `server/docs/API.md` : régénéré intégralement depuis les 26 fichiers de `server/src/routes/`. Structure : base URL, authentification (JWT + API Key), rate limiting, format de réponses, pagination, puis un chapitre par module (méthode, route, permission requise, corps de requête d'après les schémas Zod, réponse type).
- `server/docs/openapi.json` : spec OpenAPI 3.0 cohérente avec le Markdown (paths, securitySchemes bearer + apiKey, schémas de requête).
- Emplacement `server/docs/` retenu (et non la racine) car les `.md` racine sont **gitignorés** (« docs internes hors dépôt ») alors que le déploiement prod passe par Git : les fichiers servis doivent être versionnés.
- Note de maintenance ajoutée dans `CLAUDE.md` : mettre à jour ces deux fichiers quand une route change.

### 2. Permission
- Nouvelle entrée dans `PERMISSIONS` de `server/src/prisma/seed.ts` : `{ key: 'apidocs:read', label: 'Consulter la documentation API', category: 'Paramètres' }`, attribuée au rôle ADMIN par le seed.
- Apparaît automatiquement dans la page Rôles existante (groupement par catégorie) → attribution libre à d'autres rôles.

### 3. Serveur — `server/src/routes/docs.ts`
- `GET /api/docs/markdown` → contenu de `API.md` (`text/markdown`)
- `GET /api/docs/openapi` → contenu de `openapi.json` (`application/json`)
- Protégées par `authenticate` (niveau app) + `requirePermission('apidocs:read')`.
- Résolution de chemin robuste dev (tsx, `src/`) / prod (build `dist/`) vers `server/docs/`.
- Montage dans `app.ts` : `app.use('/api/docs', authenticate, docsRoutes)`.

### 4. Client — page « Documentation API »
- `client/src/pages/docs/ApiDocsPage.tsx` : rendu du Markdown via `react-markdown` + `remark-gfm` (nouvelles dépendances), sommaire cliquable généré depuis les titres, deux boutons de téléchargement (blob via l'API authentifiée, pas d'URL publique).
- Route protégée par `apidocs:read` (mécanisme `ProtectedRoute`/`usePermission` existant), entrée Sidebar conditionnelle.

### 5. Tests
- Test serveur : `/api/docs/*` → 403 sans permission, 200 avec, bons content-types.

## Hors périmètre
- Génération automatique de la doc depuis le code (maintenance manuelle assumée).
- Swagger UI interactif (le JSON téléchargeable suffit pour les outils).
