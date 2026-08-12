# Objectifs d'entreprise — Design (validé le 12/08/2026)

## Besoin

Permettre aux personnes habilitées de définir un **objectif d'entreprise** (cible de CA
par période), qui s'alimente automatiquement des résultats des commerciaux, et qui montre
la couverture de la cible par les objectifs individuels déjà répartis.

Décisions validées avec l'utilisateur :
- **Alimentation** : cible fixée manuellement ; progression = somme du CA gagné par tous
  les commerciaux ; affichage de la **répartition** (somme des objectifs individuels vs
  cible entreprise, avec le « reste à répartir »).
- **Périodes** : trimestre (`2026-Q3`), mois (`2026-01`) **et année** (`2026`).
- **Droits** : deux nouvelles permissions dédiées, gérables dans Rôles & Permissions :
  - `company_targets:read` — voir l'objectif d'entreprise (défaut : tous les rôles ayant accès aux objectifs)
  - `company_targets:write` — créer/modifier/supprimer (défaut : ADMIN, MANAGER)
- **Pipelines** : objectif entreprise **global ou ventilé par pipeline** (comme les individuels).
- **Visibilité** : contrôlée par `company_targets:read` (configurable par rôle).

## Modèle de données

Nouveau modèle Prisma `CompanyTarget` (schémas SQLite + PostgreSQL) :

```prisma
model CompanyTarget {
  id         String    @id @default(uuid())
  period     String    // "2026", "2026-Q3" ou "2026-01"
  target     Float     // cible en €
  pipelineId String?   // null = global tous pipelines
  pipeline   Pipeline? @relation(fields: [pipelineId], references: [id], onDelete: SetNull)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

Unicité `(period, pipelineId)` garantie applicativement (upsert), comme pour `SalesTarget`.
Migration additive versionnée (PostgreSQL) + `db:push` en dev SQLite.

## API (`server/src/routes/targets.ts`)

- `GET /api/targets/company?period=` — `company_targets:read`. Retourne les objectifs
  entreprise de la période, chacun enrichi de :
  - `computedActual` : Σ valeur des opportunités **gagnées** (`closedAt` dans la période),
    tous commerciaux, filtrées par pipeline si l'objectif est ventilé.
  - `allocatedTarget` : Σ des objectifs individuels couvrant la période sur le même
    périmètre, **sans double comptage** :
    - temps : pour un objectif trimestriel, un commercial avec objectif trimestre prime
      sur ses objectifs mensuels du même trimestre ; pour un objectif annuel, trimestres
      d'abord, puis mois non couverts par un trimestre du même commercial.
    - périmètre : pour un objectif entreprise global, l'objectif individuel global d'un
      commercial prime sur ses objectifs par pipeline (même règle que l'UI actuelle) ;
      pour un objectif entreprise par pipeline, seuls les objectifs individuels de ce
      pipeline comptent.
- `POST /api/targets/company` — `company_targets:write`, upsert par `(period, pipelineId)`.
- `PUT /api/targets/company/:id`, `DELETE /api/targets/company/:id` — `company_targets:write`.
- `parsePeriod` étendu au format annuel `^\d{4}$`.

## UI (`client/src/pages/targets/TargetsPage.tsx`, onglet Objectifs)

Bandeau « Objectif d'entreprise » en haut de l'onglet (visible si `company_targets:read`) :
- **Carte période sélectionnée** (trimestre courant du sélecteur existant) + **carte année**
  correspondante — pas de changement du sélecteur de période.
- Chaque carte : cible, barre « Réalisé » (CA gagné collectif), barre « Réparti » (somme des
  objectifs individuels) avec mention « reste à répartir X € » ou « répartition complète ».
- Détail par pipeline si des objectifs entreprise ventilés existent.
- Bouton « Définir » / crayon (si `company_targets:write`) → modale : montant, pipeline
  (optionnel), période (pré-remplie, choix trimestre/année). Suppression possible.
- État vide pédagogique si aucun objectif entreprise défini.

## Sécurité / RBAC

- Seed : ajout des 2 permissions (catégorie « Objectifs ») ; `company_targets:read` ajouté
  aux rôles MANAGER + COMMERCIAL (ADMIN implicite), `company_targets:write` à MANAGER.
- Le seed de prod devra être rejoué sur Plesk pour créer les permissions.

## Tests

`server/tests/api/company-targets.test.ts` (vitest + supertest) : CRUD + RBAC
(commercial ne peut pas écrire), calcul `computedActual` et `allocatedTarget`
(y compris dédoublonnage trimestre/mois et global/pipeline, période annuelle).

## Docs

`API.md` + `openapi.json` mis à jour (obligatoire), note dans `JOURNAL.md`.
