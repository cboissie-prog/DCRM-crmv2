# Prospection — leads fusionnés dans les opportunités, vue Liste, Kanban allégé, import CSV

**Date** : 2026-10-05
**Statut** : validé par Clément (import CSV inclus, avec correspondance des colonnes)

## 1. Problème

- Deux endroits pour un prospect (page Leads puis Kanban) : clics inutiles. En prod, les 4 leads
  sont tous convertis : la page ne sert plus.
- Une campagne de prospection IT (~200 prospects à traiter ligne par ligne) rendrait le Kanban
  illisible. Il faut une vue Liste faite pour appeler, noter et planifier, et un Kanban qui ne
  montre que l'essentiel par colonne.
- Saisir 200 prospects à la main n'est pas envisageable : import CSV avec correspondance des
  colonnes du fichier vers les champs du CRM.

## 2. Périmètre

**Inclus**
- Suppression du modèle `Lead`, de ses routes, de la page Leads, du déclencheur d'automatisation
  `LEAD_SCORE_THRESHOLD`. Conversion des leads non convertis en opportunités avant suppression.
- Nouveaux champs de prospection sur `Opportunity` : `source`, `prospectStatus`, `lastContactedAt`,
  `callAttempts`, `nextAction`.
- Vue Liste du pipeline (bascule Kanban | Liste), statut de prospection à un clic, rappel à un clic,
  téléphone cliquable, édition en ligne, filtres, tri, pagination serveur, sélection multiple.
- Kanban : 5 cartes par colonne + « Afficher les N autres ».
- Import CSV de prospects avec écran de correspondance des colonnes, création en lot entreprise +
  contact + opportunité.

**Exclus**
- Click-to-call via OVH (à étudier plus tard). Scoring automatique des contacts (`Contact.leadScore`
  reste tel quel). Modification du dashboard, des objectifs, des rapports.

## 3. Modèle de données

### Opportunity (nouveaux champs)
| Champ | Type | Rôle |
|---|---|---|
| `source` | `String @default("MANUAL")` | référentiel `lead_source` (repris du lead) |
| `prospectStatus` | `String @default("TODO")` | `TODO` À traiter · `NO_ANSWER` Appelé sans réponse · `REACHED` Joint · `CALLBACK` À rappeler |
| `lastContactedAt` | `DateTime?` | dernier clic Appelé / Joint |
| `callAttempts` | `Int @default(0)` | incrémenté à chaque Appelé sans réponse / Joint |
| `nextAction` | `String?` | note courte « rappeler le gérant, absent le lundi » |

`remindAt` (existant) porte la date de rappel.

### Suppression de Lead
- Migration `20261006_prospection` en deux temps dans le même fichier SQL : (1) ajout des colonnes ;
  (2) `INSERT INTO "Opportunity"` pour chaque lead dont `status <> 'CONVERTED'` et sans opportunité
  liée (titre, contactId, companyId du contact, source, notes = description, pipelineId = pipeline
  par défaut, stage = première étape de ce pipeline) ; (3) `ALTER TABLE "Opportunity" DROP COLUMN "leadId"`,
  `DROP TABLE "Lead"`. En prod aucun lead à convertir ; la migration reste correcte pour la base dev.
- Relations retirées : `Contact.leads`, `Opportunity.lead`.

## 4. API

### Supprimé
`GET/POST/PUT/PATCH/DELETE /pipeline/leads*`, `POST /pipeline/leads/:id/convert`,
déclencheur `LEAD_SCORE_THRESHOLD` (automation-engine + page Automatisations). Les automatisations
existantes de ce type sont supprimées par la migration (`DELETE FROM "Automation" WHERE trigger = 'LEAD_SCORE_THRESHOLD'`,
vérifier le nom réel de la colonne/table).

### Modifié
- `POST /pipeline/opportunities` et `PUT /pipeline/opportunities/:id` acceptent `source`
  (validé contre `lead_source`), `prospectStatus`, `nextAction`, `remindAt`.
- `GET /pipeline/opportunities` : nouveaux filtres `prospectStatus`, `source`, `stage` (déjà),
  `remindToday=true` (`remindAt` dans la journée, heure serveur), `neverContacted=true`
  (`lastContactedAt` null), `staleDays=N` (`lastContactedAt` plus vieux que N jours ou null),
  `search` (titre, entreprise, contact) ; tri `sortBy` ∈ `createdAt | updatedAt | title | value |
  remindAt | lastContactedAt | prospectStatus | stage | company` + `sortOrder`. Comportement sans
  paramètre inchangé.
- `PATCH /pipeline/opportunities/:id/stage` inchangé.

### Nouveau
- `PATCH /pipeline/opportunities/:id/prospect` (permission `pipeline:update`) :
  `{ prospectStatus?, remindAt?: string | null, nextAction?: string | null }`. Règles : `NO_ANSWER`
  ou `REACHED` → `lastContactedAt = now`, `callAttempts + 1` et une `Activity`
  (`type: 'CALL'`, titre « Appel sans réponse » / « Joint par téléphone », `opportunityId`,
  `contactId`, `userId`) ; `CALLBACK` exige `remindAt` ; `TODO` ne touche pas aux compteurs.
  Retourne l'opportunité.
- `POST /pipeline/opportunities/bulk` (permission `pipeline:update`) :
  `{ ids: string[], action: 'assign' | 'stage' | 'archive' | 'prospectStatus', value?: string }`
  (max 200 ids). Retourne `{ updated: n }`. `archive` refuse les étapes ouvertes (ignorées, comptées
  dans `skipped`).
- `POST /pipeline/opportunities/import/csv` (permission `pipeline:create`) :
  ```json
  { "pipelineId": "…", "stage": "NEW", "source": "COLD_CALL", "assignedToId": "…",
    "rows": [ { "companyName": "…", "firstName": "…", "lastName": "…", "phone": "…", "email": "…",
               "title": "…", "value": "1200", "notes": "…", "city": "…", "postalCode": "…", "website": "…", "siret": "…" } ] }
  ```
  Le client a déjà appliqué la correspondance : les clés sont les champs CRM, pas les en-têtes du
  fichier. Règles : max 500 lignes ; `companyName` requis (sinon ligne ignorée) ; entreprise
  retrouvée par nom exact insensible à la casse, sinon créée ; contact retrouvé par email (si fourni)
  puis par nom+prénom dans l'entreprise, sinon créé (si prénom ou nom fourni) ; opportunité créée
  avec `title` (défaut : nom de l'entreprise), `value` (défaut 0), `source`, `prospectStatus TODO`,
  `assignedToId`, `pipelineId`, `stage`. Une opportunité ouverte existante pour la même entreprise dans
  le même pipeline → ligne ignorée (pas de doublon). Réponse
  `{ created: { companies, contacts, opportunities }, skipped, errors: [{ row, reason }] }`.
  Tout en transaction par lots de 50.
- Docs API + openapi.

## 5. Client

### Page Pipeline : bascule Kanban | Liste
- Deux boutons segmentés dans l'en-tête ; vue mémorisée dans `localStorage` (`pipeline-view`).
  Route `/pipeline?view=list` acceptée pour les liens directs. La page Leads, l'entrée de menu
  « Leads » et la route `/leads` disparaissent (`/leads` redirige vers `/pipeline?view=list`).
- Les filtres communs (pipeline, commercial, recherche) restent au-dessus des deux vues.

### Kanban allégé
- Chaque colonne affiche au plus 5 cartes (tri : `remindAt` du jour ou dépassé d'abord, puis
  `updatedAt` desc). Pied de colonne : « Afficher les 38 autres » qui déplie la colonne (état par
  colonne, réinitialisé au changement de pipeline). Le compteur et le montant total de la colonne
  restent calculés sur l'ensemble. Le lien « N archivées » reste.

### Vue Liste (`client/src/pages/pipeline/PipelineListView.tsx`)
- Tableau dense, en-têtes cliquables pour le tri (icône de sens), colonnes :
  case à cocher · Prospect (titre, entreprise en dessous) · Contact (nom + **téléphone** en lien
  `tel:` avec bouton copier) · Statut de prospection (pastille cliquable qui ouvre un menu : À traiter /
  Appelé sans réponse / Joint / À rappeler) · Rappel (date, menu : Demain / Dans 3 jours / Lundi
  prochain / Date libre / Effacer) · Étape (select en ligne) · Commercial (select en ligne) ·
  Montant HT (saisie en ligne au clic) · Source · Dernier contact (relatif) + tentatives · Prochaine
  action (texte en ligne, enregistré au blur) · Créé le.
- Lignes « rappel aujourd'hui ou dépassé » surlignées ambre ; `À traiter` jamais contacté en gras.
- Barre de filtres : étape, commercial, source, statut de prospection, raccourcis « À rappeler
  aujourd'hui », « Jamais contacté », « Sans contact depuis 7 j », recherche texte. Filtres dans l'URL
  (`searchParams`) pour partager/revenir.
- Pagination serveur 50 lignes, sélecteur 50/100/200.
- Sélection multiple : barre d'actions « 12 sélectionnées » → Assigner à…, Déplacer vers l'étape…,
  Statut de prospection…, Archiver. Confirmation pour Archiver.
- Clic sur le titre → modale d'édition existante (`OpportunityModal`), qui gagne les champs Source,
  Prochaine action, Rappel.
- Bouton « Importer des prospects » (permission `pipeline:create`).

### Import CSV avec correspondance (`client/src/components/ui/ImportCsvModal.tsx` généralisé ou nouveau `ImportProspectsModal.tsx`)
Assistant en trois étapes dans une modale `lg` :
1. **Fichier** : glisser-déposer, CSV (`,` ou `;`, UTF-8, BOM toléré), max 500 lignes, 2 Mo ;
   modèle téléchargeable. Aperçu des 5 premières lignes.
2. **Correspondance** : pour chaque champ CRM (Entreprise *, Prénom, Nom, Téléphone, Email, Titre
   de l'opportunité, Montant HT, Ville, Code postal, Site web, SIRET, Notes), un select « Colonne du
   fichier » pré-rempli par **auto-détection** (en-têtes normalisés sans accents/majuscules, synonymes :
   société/raison sociale/company → Entreprise ; tel/téléphone/mobile/portable → Téléphone ;
   mail/e-mail → Email ; nom/lastname ; prénom/firstname ; CA/montant/budget → Montant ; etc.).
   Option « Ignorer ». Paramètres communs à toutes les lignes : pipeline, étape de départ (défaut :
   première étape), source (référentiel `lead_source`, défaut `COLD_CALL`), commercial assigné (défaut :
   utilisateur courant). Erreur si Entreprise n'est pas associée. La correspondance est mémorisée dans
   `localStorage` par jeu d'en-têtes (clé = en-têtes triés) pour les imports suivants.
3. **Récapitulatif** : « 196 lignes, 4 sans entreprise ignorées », bouton Importer, puis résultat
   détaillé (créés / ignorés / erreurs par ligne) avec téléchargement du rapport CSV des lignes ignorées.
L'import existant des pages Entreprises et Contacts n'est pas modifié dans ce chantier.

### Autres écrans
- Appels : « Créer un lead depuis l'appel » devient « Créer une opportunité depuis l'appel »
  (`POST /pipeline/opportunities`, source `PHONE_INBOUND`/`COLD_CALL` selon le sens, contact
  = celui de l'appel ou créé via EntityPicker, étape = première du pipeline par défaut).
- Fiche contact : la section Leads (si présente) est remplacée par la liste des opportunités du contact.
- Automatisations : le déclencheur « Score lead atteint » disparaît du catalogue.
- Documentation API et PROGRESS.

## 6. Tests
- Serveur : `prospection.test.ts` — `PATCH /prospect` (compteurs, activité, CALLBACK sans remindAt →
  400) ; filtres `remindToday`, `neverContacted`, `staleDays`, tri ; `bulk` (assign, stage, archive
  avec étape ouverte ignorée) ; `import/csv` (création entreprise+contact+opportunité, réutilisation
  d'une entreprise existante, doublon d'opportunité ignoré, ligne sans entreprise → `errors`, >500 → 400) ;
  routes `/leads*` → 404.
- Client : `lib/csvMapping.test.ts` (auto-détection des en-têtes, normalisation), `PipelineListView`
  rendu de base (lignes, tri par clic) si raisonnable ; suites existantes vertes ; lint 0 erreur ; build.
- Manuel Chrome : import d'un CSV de 10 lignes avec en-têtes « Société;Contact;Tél », correspondance
  auto, résultat, passage en liste, clic Appelé → compteur, rappel demain → ligne surlignée, sélection
  multiple assigner, Kanban « Afficher les N autres ».
