# Ticket — fil unique, pièces jointes dans les commentaires, colonne info compacte

**Date** : 2026-10-05
**Statut** : validé par Clément (pièces jointes conservées mais rattachées aux commentaires ; le reste tel que proposé)

## 1. Problème

La page de détail d'un ticket (`client/src/pages/tickets/TicketsPage.tsx`, composant `TicketDetailPage`)
empile dans la colonne principale quatre cartes (Description, Pièces jointes, Interventions,
Commentaires) et dans la colonne de gauche trois cartes (Informations, Temps passé détaillé,
Historique). L'information est éclatée, la colonne de gauche prend un tiers de la largeur et les
valeurs longues débordent.

## 2. Périmètre

**Inclus**
- Une seule carte « Fil du ticket » dans la colonne principale, chronologique, qui réunit
  description, notes internes, commentaires, événements, interventions planifiées et temps ajoutés.
- Pièces jointes **rattachées aux commentaires** : on joint des fichiers en écrivant un commentaire,
  elles s'affichent dans la bulle du commentaire. Plus de carte dédiée ni d'upload isolé.
- Colonne de gauche réduite à un quart, valeurs tronquées avec infobulle au survol.
- Suppression des cartes Historique, Interventions et Pièces jointes (leur contenu vit dans le fil).

**Exclus**
- Modification des données existantes (les 4 pièces jointes orphelines éventuelles restent lisibles).
- Édition ou suppression d'un commentaire (n'existe pas aujourd'hui, n'est pas ajouté).
- Tout changement sur la liste des tickets, le formulaire de création/édition, les modales
  intervention et temps.

## 3. Modèle de données et API

### Prisma
- `TicketAttachment.commentId String?` + relation `comment TicketComment? @relation(fields: [commentId], references: [id], onDelete: Cascade)` + `@@index([commentId])`.
- `TicketComment.attachments TicketAttachment[]`.
- Migration `20261005_comment_attachments` générée par `prisma migrate diff` entre le
  `schema.postgres.prisma` commité et celui régénéré par `scripts/make-postgres-schema.mjs`
  (méthode du module Todo). Colonne nullable : aucune donnée à migrer.

### Routes (`server/src/routes/tickets.ts`)
- `POST /tickets/:id/comments` accepte désormais **soit** du JSON (`{ content, isInternal }`, inchangé)
  **soit** du `multipart/form-data` avec `content`, `isInternal` et `files` (0 à 5 fichiers, 10 Mo max
  chacun, mêmes types autorisés qu'aujourd'hui : images, PDF, Office, txt, csv, log, zip).
  Règle : `content` peut être vide **si** au moins un fichier est joint ; sinon `400 VALIDATION_ERROR`.
  Un fichier refusé → `400 INVALID_FILE_TYPE` / `UPLOAD_ERROR`, rien n'est créé (fichiers déjà écrits
  supprimés du disque). Réponse `201` : le commentaire avec `attachments[]`
  (`{ id, filename, mimeType, size, createdAt }`). Audit `TICKET_ATTACHMENT_UPLOADED` par fichier.
  Plus d'événement `ATTACHMENT_ADDED` (la pièce jointe est portée par le commentaire).
- `POST /tickets/:id/attachments` **supprimé** (plus d'appelant).
- `GET /tickets/attachments/:attachmentId/download` et `DELETE /tickets/attachments/:attachmentId`
  **conservés** tels quels.
- `GET /tickets/:id` : `comments[]` inclut `attachments[]` ; le tableau `attachments` de premier niveau
  ne renvoie plus que les pièces jointes **sans commentaire** (`commentId: null`, héritage), toujours
  avec `uploadedBy`.
- `server/docs/API.md` et `openapi.json` mis à jour (route supprimée, multipart sur comments, formes de réponse).

## 4. Client — page de détail

### Disposition
- Grille `lg:grid-cols-4` : colonne info `lg:col-span-1`, fil `lg:col-span-3`.
- Colonne info : carte **Informations** (valeurs en `truncate` + infobulle), carte **Temps passé**
  réduite au total et au bouton « + » (les entrées sont dans le fil). Cartes Historique, Interventions
  et Pièces jointes supprimées, composant `AttachmentsCard` supprimé.

### Infobulle
- Nouveau `client/src/components/ui/Tooltip.tsx` : `<Tooltip content={string}>{children}</Tooltip>`,
  CSS pur (`group` / `group-hover`), bulle sombre arrondie au-dessus de l'élément, `max-w-xs`,
  texte en `whitespace-normal`, délai d'apparition court (transition), accessible (`title` non utilisé,
  `aria-label` posé sur l'enfant). N'affiche la bulle que si `content` est non vide.
- Dans Informations, chaque valeur texte (catégorie, entreprise, contact, technicien, équipement,
  créé par, avis client) est rendue `truncate` dans un conteneur `min-w-0` et enveloppée dans `Tooltip`.

### Fil du ticket
- Fonction pure `buildTicketThread(ticket): ThreadItem[]` dans `client/src/lib/ticketThread.ts`,
  testée unitairement. Types d'items :
  - `description` (date `createdAt`, auteur `createdBy`) — toujours premier.
  - `note` (notes internes, même date, juste après la description) — si `ticket.notes`.
  - `comment` (chaque `TicketComment`, avec `attachments`).
  - `system` (une ligne) avec sous-type :
    - `event` : chaque `TicketEvent` **sauf** `TIME_ADDED` (remplacé par `time`) ; libellés de `eventLabel`.
    - `intervention` : chaque `ticket.appointments[]`, date = `createdAt` de l'intervention, texte
      « Intervention planifiée le JJ/MM/AAAA à HH:MM · titre · prénom nom, … », suffixe « À venir » / « Passée ».
    - `time` : chaque `ticket.timeEntries[]`, texte « Prénom Nom a ajouté 45 min · note ».
    - `attachment` : chaque pièce jointe orpheline (`ticket.attachments[]`), texte
      « Pièce jointe ajoutée par Prénom Nom », avec puce téléchargeable.
  - Tri par date croissante ; à date égale, ordre : description, note, event, intervention, time, attachment, comment.
- Rendu dans une seule carte « Fil du ticket » (compteur = nombre de commentaires) :
  - `description` : bulle fond `indigo-50` bordure `indigo-100`, étiquette « Description » indigo.
  - `note` : bulle ambre avec étiquette « Note interne » et cadenas (même style que commentaire interne).
  - `comment` : inchangé (interne = fond ambre, cadenas « Interne »), plus la liste des pièces jointes
    sous le texte : puces `[icône] nom.ext · 1,2 Mo`, clic = téléchargement via l'API (blob avec
    en-tête d'autorisation, comme `AttachmentsCard` aujourd'hui), petite croix de suppression si
    `tickets:update`.
  - `system` : ligne compacte `text-xs text-slate-500`, point coloré à gauche (mêmes couleurs que
    l'ancien Historique : création indigo, réouverture orange, avis ambre, intervention violet,
    temps gris), auteur et date relative à droite.
  - Zone de saisie en bas (si `tickets:update`) : textarea, case « Commentaire interne », bouton
    trombone « Joindre » (`input type=file multiple`, extensions autorisées dans `accept`), puces des
    fichiers sélectionnés avec croix pour retirer, bouton « Envoyer » actif si texte **ou** fichier.
    Envoi en `FormData` (`content`, `isInternal`, `files`). Erreur API affichée en toast.

## 5. Tests

- Serveur, `tests/api/ticket-comment-attachments.test.ts` : commentaire JSON inchangé (201) ;
  commentaire multipart avec un fichier `.txt` (201, `attachments.length === 1`, fichier présent
  sur disque) ; multipart sans texte avec fichier (201) ; sans texte ni fichier (400) ; type
  refusé `.exe` (400 `INVALID_FILE_TYPE`, aucun commentaire créé) ; `GET /tickets/:id` renvoie la
  pièce jointe dans `comments[].attachments` et pas dans `attachments` ; téléchargement (200) ;
  `POST /tickets/:id/attachments` → 404. Nettoyage disque en `afterAll`.
- Client : `lib/ticketThread.test.ts` (ordre, remplacement de `TIME_ADDED`, items intervention et
  orphelins) ; `components/ui/Tooltip.test.tsx` (bulle rendue avec le contenu, absente si vide).
- Suites existantes vertes, lint 0 erreur, build propre, vérification manuelle en dev dans Chrome
  (commentaire avec deux fichiers, téléchargement, infobulle).
