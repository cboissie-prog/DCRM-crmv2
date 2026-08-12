# Clés API à portée restreinte (scopes) — Design

**Date** : 2026-08-12
**Statut** : approuvé

## Objectif

Limiter les droits de chaque clé API par fonctionnalité : aujourd'hui une clé hérite de tous les droits de son propriétaire (`*` pour un ADMIN). Désormais chaque clé porte une liste explicite de permissions.

## Décisions produit (validées)

- **Clés existantes** : remises à zéro (`[]` = aucun droit) — à reconfigurer via l'édition. Sécurité maximale assumée, les intégrations existantes doivent être reconfigurées.
- **Édition** : les droits d'une clé sont modifiables après création (la valeur de la clé ne change pas).

## Modèle

- `ApiKey.scopes String @default("[]")` — tableau JSON de clés de permission (`["tickets:read", …]`). Champ texte (pas de JSON natif en SQLite dev). Ajouté à `schema.prisma` ET `schema.postgres.prisma` + migration versionnée `20260812_apikey_scopes` (`ALTER TABLE … DEFAULT '[]'`).

## Règle d'autorisation (middleware `authenticate`, branche X-API-Key)

Permissions effectives = **intersection** des scopes de la clé et des droits actuels du propriétaire.
- Propriétaire ADMIN : les scopes tels quels — une clé ne reçoit **plus jamais** le bypass `*`.
- Si le propriétaire perd un droit, ses clés le perdent immédiatement (évaluation à chaque requête).
- Scopes invalides/illisibles → `[]` (aucun droit), jamais d'erreur 500.
Le flux JWT navigateur ne change pas.

## API (`/api/apikeys`, permission `apikeys:manage`)

- `GET /` : ajoute `permissions: string[]` à chaque clé.
- `POST /` : accepte `permissions: string[]` (défaut `[]`). Validation : chaque clé doit exister dans la table `Permission` ET, pour un non-admin, appartenir aux droits de l'appelant → sinon `400 INVALID_PERMISSIONS`.
- `PUT /:id/permissions` : remplace les scopes (propriétaire uniquement, même validation, audité `APIKEY_PERMISSIONS_CHANGED`).
- `GET /permissions` : permissions attribuables par l'appelant, groupées par catégorie (toutes pour un admin, les siennes sinon) — la liste complète existante exige `settings:roles`, inaccessible aux simples porteurs de `apikeys:manage`.

## UI (onglet Clés API des Paramètres)

- Formulaire de création : sélecteur de droits groupé par catégorie (checkbox par permission + « tout cocher » par catégorie), avertissement si aucun droit sélectionné.
- Liste : badge « N droits » (rouge « Aucun droit » si zéro — repère les clés à reconfigurer), bouton « Modifier les droits » ouvrant le même sélecteur, enregistrement via PUT.
- Texte d'intro mis à jour (la clé n'a que les droits attribués, dans la limite de ceux du propriétaire).

## Docs & tests

- `server/docs/API.md` + `openapi.json` : module Clés API (nouvelles routes/champs) + note dans la section Authentification.
- Tests API `apikey-scopes.test.ts` : clé scopée 200/403 selon la route, clé sans scope 403 partout, clé d'ADMIN scopée sans `*`, édition des scopes effective, non-admin refusé au-delà de ses droits (400), `GET /permissions` filtré par rôle.

## Hors périmètre

- Expiration/rotation automatique des clés, quotas par clé.
