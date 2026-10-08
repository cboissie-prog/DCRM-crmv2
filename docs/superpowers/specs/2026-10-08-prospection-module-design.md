# Module Prospection — listes de prospects, traitement par le commercial, qualification vers le pipeline, suivi des opportunités

**Date** : 2026-10-08
**Statut** : validé par Clément (brainstorm du 08/10 : pipeline par défaut par liste modifiable à la qualification, critères de qualification paramétrables avec socle fourni, listes visibles par tous avec traçabilité par commercial, pas d'email depuis le CRM)

## 1. Vision

Inspiré de noCRM (listes de prospection séparées du pipeline, qualification en un clic, script dans la fiche)
et de Pipedrive (vente par activités : chaque fiche ouverte a une prochaine action datée ; alerte sinon).

**Un seul objet, deux espaces.** Un prospect et une opportunité sont la même fiche `Opportunity` :
- en **prospection** tant que `pipelineId` est `null` (elle appartient à une liste de prospection) ;
- dans le **pipeline** une fois qualifiée (`pipelineId` + `stage` posés). L'historique suit, rien n'est copié.

Le commercial travaille dans « Ma journée » et dans ses listes, à coups d'actions à un clic qui écrivent
toutes une `Activity` horodatée avec son auteur. La même fiche de suivi (chronologie, prochaine action,
grille de qualification, documents envoyés) sert dans le pipeline, ce qui comble le manque actuel de suivi.

## 2. Périmètre

**Inclus** : listes de prospection, import CSV dans une liste (assistant existant réutilisé), écran de
traitement avec actions rapides et cadence, panneau de suivi (prospect et opportunité), grille de
qualification paramétrable, qualification vers le pipeline, « Ma journée », suivi par commercial,
alertes « sans prochaine action » / « sans activité depuis N jours » sur le Kanban, réglages.
**Exclus** : email depuis le CRM, click-to-call OVH, séquences automatiques d'emails, scoring.

## 3. Modèle de données

### `ProspectList` (nouveau)
| Champ | Type | Rôle |
|---|---|---|
| `id`, `name` | | « IT Roanne octobre 2026 » |
| `description` | `String?` | |
| `source` | `String @default("COLD_CALL")` | référentiel `lead_source`, appliqué aux prospects importés |
| `pipelineId` | `String?` | pipeline par défaut à la qualification (défaut : pipeline `isDefault`) |
| `assignedToId` | `String?` | commercial par défaut des prospects de la liste |
| `status` | `String @default("ACTIVE")` | `ACTIVE` · `ARCHIVED` |
| `createdById` | `String?` | |
| `createdAt`, `updatedAt` | | |

### `Opportunity` (ajouts)
| Champ | Type | Rôle |
|---|---|---|
| `listId` | `String?` → `ProspectList` (`onDelete: SetNull`) | liste d'origine, conservée après qualification (statistiques) |
| `qualification` | `String?` | JSON `{ "<clé critère>": true\|false\|null }` (texte : SQLite n'a pas de type JSON) |
| `documentsSent` | `String?` | JSON `["PLAQUETTE","TARIFS"]` |
| `qualifiedAt` | `DateTime?` | date de passage dans le pipeline |
| `lastActivityAt` | `DateTime?` | dernière `Activity` (mise à jour par le serveur à chaque action) |

`prospectStatus` étendu : `TODO` À traiter · `NO_ANSWER` Sans réponse · `REACHED` Joint · `CALLBACK` À rappeler ·
`UNREACHABLE` Injoignable · `NOT_INTERESTED` Pas intéressé · `QUALIFIED` Qualifié (= dans le pipeline).
`remindAt` + `nextAction` = **prochaine action** (date + libellé court). `assignedToId` = **traité par**.

### `Activity` (existant, réutilisé comme journal)
Types ajoutés : `CALL_NO_ANSWER`, `CALL_REACHED`, `CALLBACK_SET`, `DOC_SENT`, `EMAIL_SENT`, `MEETING_SET`,
`NOT_INTERESTED`, `UNREACHABLE`, `QUALIFIED`, `NOTE`, `STAGE_CHANGED`, `NEXT_ACTION_SET`. `userId` = auteur
(traçabilité), `opportunityId`, `contactId`, `companyId`, `description` = détail (raison, document, note).

### Référentiels (seed `reference-domains.ts`, modifiables dans Réglages > Listes)
- `qualification_criteria` : `NEED` Besoin identifié · `DECISION_MAKER` Décideur joint · `BUDGET` Budget évoqué ·
  `TIMELINE` Échéance connue · `CURRENT_SETUP` Équipement actuel identifié · `COMPETITOR` Concurrent en place.
- `prospect_documents` : `PLAQUETTE` Plaquette · `TARIFS` Grille tarifaire · `DEVIS` Devis · `PRESENTATION` Présentation.
- `not_interested_reasons` : `NO_NEED` Pas de besoin · `HAS_PROVIDER` Déjà équipé · `BUDGET` Budget · `TIMING` Pas maintenant · `OTHER` Autre.

### Réglages (`DEFAULTS`, onglet Système > section « Prospection »)
`prospectCallbackDays` = 2 (rappel proposé après « Sans réponse »), `prospectMaxAttempts` = 3 (au-delà →
Injoignable), `prospectUnreachableRetryDays` = 30, `dealStaleDays` = 7 (alerte « sans activité » dans le pipeline).

### Permissions (seed, idempotent)
`prospection:read` (tous rôles sauf TECHNICIEN), `prospection:write` (COMMERCIAL, MANAGER, ADMIN),
`prospection:manage` (MANAGER, ADMIN : créer/archiver des listes, réassigner en lot, suivi de tous les commerciaux).

### Migration `20261008_prospection_module` : table `ProspectList`, colonnes `Opportunity`, aucune donnée à migrer.

## 4. API

### Listes `/api/prospection/lists`
- `GET /` (`prospection:read`) : listes actives (+ `?status=ARCHIVED`), avec compteurs par liste :
  `total`, `todo`, `contacted`, `callback`, `qualified`, `rejected`, `unreachable`.
- `POST /` (`prospection:manage`) `{ name, description?, source?, pipelineId?, assignedToId? }`.
- `PUT /:id`, `PATCH /:id/archive`, `PATCH /:id/unarchive` (`prospection:manage`). Pas de suppression.
- `POST /:id/import` (`prospection:write`) : même corps et mêmes règles que `POST /pipeline/opportunities/import/csv`,
  mais les fiches créées ont `listId = :id`, `pipelineId = null`, `source` = celle de la liste (sauf surcharge),
  `assignedToId` = celui du corps ou de la liste. Doublon = fiche en prospection non écartée de la même liste
  pour la même entreprise (ou le même contact). L'ancienne route d'import du pipeline est **conservée** mais
  l'assistant du client ne l'appelle plus (il crée toujours dans une liste).
- `GET /stats?listId=&from=&to=` (`prospection:read` ; sans `prospection:manage`, limité à l'utilisateur courant) :
  par commercial `{ userId, firstName, lastName, calls, reached, callbacks, docsSent, meetings, qualified, rejected }`
  calculés sur `Activity` (auteur = `userId`, période sur `createdAt`).

### Prospects `/api/prospection/prospects`
- `GET /` (`prospection:read`) : fiches `pipelineId = null`, filtres `listId`, `prospectStatus`, `assignedToId`,
  `mine=true`, `today=true` (rappel ≤ fin de journée, ou jamais contacté dans mes listes), `search`,
  `neverContacted`, `staleDays`, tri `sortBy/sortOrder`, pagination. Inclut `contact` (téléphone, email),
  `company`, `assignedTo`, `list`.
- `POST /` (`prospection:write`) : création manuelle d'un prospect dans une liste (titre, entreprise ou contact).
- `GET /:id` : fiche + `activities` (desc, avec `user`) + `list` + `appointments` liés.

### Actions rapides `POST /api/prospection/prospects/:id/actions` (`prospection:write`)
Corps `{ action, ... }`, une `Activity` par appel, auteur = utilisateur courant. **Auto-attribution** : si la
fiche n'a pas de `assignedToId`, elle est attribuée à l'auteur de la première action.

| `action` | Effet | Champs |
|---|---|---|
| `NO_ANSWER` | `callAttempts+1`, `lastContactedAt`, statut `NO_ANSWER` ; si `callAttempts ≥ prospectMaxAttempts` → `UNREACHABLE` + rappel `+prospectUnreachableRetryDays` ; sinon rappel proposé `+prospectCallbackDays` (posé si `remindAt` absent) | — |
| `REACHED` | `callAttempts+1`, `lastContactedAt`, statut `REACHED` ; `remindAt`/`nextAction` **requis** (« et ensuite ? ») | `nextAction`, `remindAt`, `note?` |
| `CALLBACK` | statut `CALLBACK`, `remindAt` requis | `remindAt`, `nextAction?` |
| `DOC_SENT` | ajoute à `documentsSent`, Activity avec le document | `document` (clé `prospect_documents`) |
| `EMAIL_SENT` | Activity | `note?` |
| `MEETING_SET` | Activity + création d'un `Appointment` lié (type `CLIENT_MEETING`, contact, entreprise, participants = auteur) ; `remindAt` = date du RDV | `startAt`, `title?` |
| `NOTE` | Activity libre | `note` |
| `NEXT_ACTION` | met à jour `remindAt` + `nextAction` | `remindAt`, `nextAction` |
| `QUALIFICATION` | met à jour `qualification` (JSON) | `criteria: { clé: bool\|null }` |
| `NOT_INTERESTED` | statut `NOT_INTERESTED`, `lostReason`, rappel effacé | `reason` (clé `not_interested_reasons`), `note?` |
| `REOPEN` | depuis `NOT_INTERESTED`/`UNREACHABLE` → `TODO` | — |

Réponse : la fiche à jour. Toute action met `lastActivityAt = now`.

### Qualification `POST /api/prospection/prospects/:id/qualify` (`prospection:write`)
`{ pipelineId?, stage?, title?, value?, expectedCloseDate?, nextAction?, remindAt? }` → `pipelineId` (défaut :
celui de la liste, sinon pipeline par défaut), `stage` (défaut : première étape ouverte), `prospectStatus = QUALIFIED`,
`qualifiedAt = now`, Activity `QUALIFIED`, `closedAt` inchangé. La fiche disparaît de la prospection et apparaît
dans le Kanban. `400 ALREADY_QUALIFIED` si déjà dans un pipeline.

### Opportunités (pipeline)
- `GET /pipeline/opportunities/:id` renvoie aussi `activities` (avec `user`), `list`, `qualification`, `documentsSent`,
  `lastActivityAt`.
- `POST /pipeline/opportunities/:id/actions` : **mêmes actions** que la prospection (sauf `QUALIFICATION` facultatif,
  `NOT_INTERESTED` et `REOPEN` exclus : dans le pipeline on perd via l'étape Perdu). `STAGE_CHANGED` est journalisé
  automatiquement par `PATCH /:id/stage`.
- `GET /pipeline/opportunities` : champ calculé `alert` = `NO_NEXT_ACTION` (ouverte sans `remindAt` futur) ou
  `STALE` (`lastActivityAt` ou `updatedAt` plus vieux que `dealStaleDays`), sinon `null` ; filtre `alert=true`.
- Déplacer une opportunité du pipeline **vers la prospection** n'existe pas (sens unique).

### Docs API + openapi pour tout ce qui précède.

## 5. Client

### Navigation
Groupe Commercial : **Pipeline**, **Prospection** (nouvelle entrée, permission `prospection:read`), Objectifs.
Route `/prospection` avec onglets : **Ma journée** · **Listes** · **Suivi** (onglet Suivi visible pour tous,
limité à soi sans `prospection:manage`). `/prospection/listes/:id` = écran de traitement d'une liste.
La vue Liste du pipeline reste pour les opportunités ; son bouton « Importer des prospects » est retiré
(l'import vit dans Prospection).

### Ma journée
Deux blocs : **À rappeler aujourd'hui** (rappels ≤ aujourd'hui, dépassés en premier, pastille rouge) et
**À attaquer** (jamais contactés de mes listes, 20 premiers, bouton « Suivants »). Chaque ligne = la même
ligne que l'écran de liste (actions rapides incluses). Compteur en tête : « 12 rappels · 58 à attaquer ».
Filtre « Mes prospects » actif par défaut, désactivable pour voir ceux des autres (`prospection:manage`
ou simple lecture).

### Listes
Cartes : nom, source, commercial par défaut, barre de progression (traités / total), compteurs (joints,
rappels, qualifiés, écartés), date. Boutons : **Nouvelle liste** (nom, description, source, pipeline par
défaut, commercial par défaut), **Importer** (ouvre l'assistant existant `ImportProspectsModal`, étape
supplémentaire « Liste » : liste existante ou nouvelle), **Archiver**. Clic = écran de traitement.

### Écran de traitement d'une liste (`ProspectListPage`)
Tableau dense dérivé de `PipelineListView` (mêmes mécaniques : tri serveur, filtres URL, pagination,
sélection multiple), colonnes : case · Prospect (titre, entreprise) · Contact + **téléphone `tel:`** + copier ·
Statut (pastille) · Tentatives · Dernier contact · **Prochaine action** (date + libellé, rouge si dépassée) ·
Traité par · Créé le. **Barre d'actions sur la ligne survolée/sélectionnée** : 📵 Sans réponse · ✅ Joint ·
📅 Rappeler le… · 📄 Doc envoyé ▾ · 🗓 RDV pris · ✖ Pas intéressé ▾ · ⭐ **Qualifier**. Les actions qui
exigent une info ouvrent un mini-formulaire inline (date + libellé pour Joint/Rappeler, document pour Doc,
date/heure pour RDV, raison pour Pas intéressé). Clic sur le titre → **panneau de suivi**.
Filtres : statut, traité par, « mes prospects », « à rappeler aujourd'hui », « jamais contactés », recherche.
Lot : assigner à, statut, archiver (liste) — `prospection:manage` pour assigner les prospects d'autrui.
Raccourcis clavier dans la ligne active : `N` sans réponse, `J` joint, `R` rappeler, `Q` qualifier (indiqués en infobulle).

### Panneau de suivi (`FollowUpDrawer`, un composant pour prospect et opportunité)
`Drawer` large. En-tête : titre, entreprise, contact (téléphone, email), statut, traité par, liste d'origine ou
pipeline/étape. Sections :
1. **Prochaine action** en évidence (date + libellé, édition inline, rouge si dépassée, « Aucune : à planifier » en ambre).
2. **Actions rapides** (mêmes boutons que la ligne).
3. **Grille de qualification** : une ligne par critère du référentiel `qualification_criteria`, trois états
   (oui / non / inconnu), enregistrée au clic.
4. **Documents envoyés** : cases du référentiel `prospect_documents` (cocher = action `DOC_SENT`).
5. **Chronologie** : activités desc (icône par type, auteur, date relative, détail), RDV liés, changements d'étape ;
   zone « Ajouter une note ».
6. Pied : **Qualifier → pipeline** (prospect) ouvrant la modale de qualification (pipeline pré-rempli par la
   liste, étape, titre, montant HT, date de closing prévue, prochaine action) ; ou **Modifier** (opportunité,
   modale existante).

### Pipeline
- Carte Kanban : ligne « Prochaine action » (date + libellé) ; pastille **rouge** « Aucune prochaine action »
  ou **orange** « Sans activité depuis N j » selon `alert`. Filtre « Alertes » dans l'en-tête.
- Clic sur le titre d'une carte → `FollowUpDrawer` (mode opportunité). Le menu ⋯ garde Modifier.
- Vue Liste du pipeline : colonne Prochaine action + alerte, ouverture du même panneau.

### Suivi (onglet)
Période (semaine, mois, personnalisé), liste (toutes ou une), tableau par commercial : appels, joints, rappels,
documents, RDV, qualifiés, écartés, taux joints/appels, taux qualifiés/joints. Export CSV. Sans
`prospection:manage` : une seule ligne, soi-même.

### Réglages
Système > section « Prospection » : les 4 réglages du §3. Listes personnalisées : les 3 nouveaux domaines
apparaissent automatiquement.

## 6. Tests
- Serveur `prospection-module.test.ts` : listes (CRUD, compteurs, archivage), import dans une liste (listId,
  pipelineId null, doublon par liste), actions (chaque type : statut, compteurs, Activity avec userId,
  auto-attribution, cadence NO_ANSWER → rappel J+2 puis UNREACHABLE au 3ᵉ, REACHED sans prochaine action → 400,
  MEETING_SET crée un Appointment), qualify (pipeline par défaut de la liste, étape, QUALIFIED, 400 si déjà
  qualifié, la fiche sort de `GET /prospects` et entre dans `GET /pipeline/opportunities`), stats par commercial
  (restreint sans manage), `alert` des opportunités, permissions (TECHNICIEN → 403).
- Client : `lib/prospectActions.test.ts` (libellés/icônes/validation des mini-formulaires), test de rendu de
  `FollowUpDrawer` (sections, grille), suites existantes vertes, lint 0 erreur, build.
- Manuel Chrome : créer une liste, importer 5 lignes, « Sans réponse » ×3 → Injoignable, « Joint » avec prochaine
  action, RDV pris → agenda, Qualifier → Kanban avec historique, alerte sans prochaine action sur une carte,
  onglet Suivi avec les compteurs du commercial.
