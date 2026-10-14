# Todo — listes multiples partageables, tableau en colonnes, fil de détail par tâche

**Date** : 2026-10-14
**Statut** : validé par Clément (conception présentée en discussion, « va y »)

## 1. Problème

Le module Todo (spec `2026-08-19-todos-design.md`) gère une seule liste plate par utilisateur. Clément veut :
- créer **plusieurs listes** et les **partager** avec des collègues (membres invités, droits lecture ou édition) ;
- les afficher **côte à côte en colonnes**, façon Kanban ;
- pouvoir **documenter l'avancement d'une tâche** (où on en est, ce qui a été fait) à la manière du fil
  d'un ticket, tout en gardant une vue **très minimaliste** au premier coup d'œil, le détail n'apparaissant
  qu'au clic.

## 2. Périmètre

**Inclus**
- Modèles `TodoList`, `TodoListMember`, `TodoComment`, `TodoEvent` ; `Todo` rattaché à une liste, assigné optionnel.
- Liste personnelle « Mes tâches » par utilisateur (créée à la migration et à la volée), non supprimable, non partageable.
- Partage par membres invités avec rôle `VIEWER` (lecture) ou `EDITOR` (édition).
- Page Todo en tableau horizontal : une colonne par liste, ajout rapide par colonne, glisser-déposer entre colonnes.
- Panneau latéral de détail de tâche : champs éditables + fil chronologique (commentaires + événements système).
- Rappels d'échéance envoyés à l'assigné (sinon au créateur), lien direct vers le panneau de la tâche.
- Migration PostgreSQL avec remplissage des données existantes. Seed, doc API (`API.md`, `openapi.json`) à jour.

**Exclus**
- Pièces jointes sur les commentaires, édition ou suppression d'un commentaire.
- Ordre manuel des tâches dans une colonne (le tri serveur reste : non faites, priorité, échéance).
- Option « visible de toute l'entreprise » sur une liste (le partage passe uniquement par les membres).
- Sous-tâches, étiquettes, récurrence.

## 3. Modèle de données

Dans `server/src/prisma/schema.prisma`, puis régénérer `schema.postgres.prisma` via `npm run db:schema:postgres`.

```prisma
model TodoList {
  id         String   @id @default(uuid())
  name       String
  color      String?            // clé Tailwind libre ex. "violet", "blue", "emerald" ; null = neutre
  isPersonal Boolean  @default(false)   // une seule par utilisateur, non supprimable, non partageable
  position   Int      @default(0)
  ownerId    String
  owner      User     @relation("TodoListOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  members    TodoListMember[]
  todos      Todo[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([ownerId])
}

model TodoListMember {
  id        String   @id @default(uuid())
  listId    String
  list      TodoList @relation(fields: [listId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation("TodoListMembership", fields: [userId], references: [id], onDelete: Cascade)
  role      String   @default("EDITOR")   // VIEWER | EDITOR
  createdAt DateTime @default(now())

  @@unique([listId, userId])
  @@index([userId])
}

model Todo {
  // champs existants conservés : id, title, description, priority, isDone, isPrivate, dueDate, completedAt, ownerId, createdAt, updatedAt
  listId     String
  list       TodoList @relation(fields: [listId], references: [id], onDelete: Cascade)
  assigneeId String?
  assignee   User?    @relation("TodoAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  comments   TodoComment[]
  events     TodoEvent[]

  @@index([listId])
  @@index([assigneeId])
}

model TodoComment {
  id         String   @id @default(uuid())
  todoId     String
  todo       Todo     @relation(fields: [todoId], references: [id], onDelete: Cascade)
  content    String
  authorId   String?
  author     User?    @relation("TodoCommentAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  authorName String
  createdAt  DateTime @default(now())

  @@index([todoId])
}

model TodoEvent {
  id        String   @id @default(uuid())
  todoId    String
  todo      Todo     @relation(fields: [todoId], references: [id], onDelete: Cascade)
  type      String   // CREATED | DONE | REOPENED | ASSIGNED | UNASSIGNED | MOVED | DUE_CHANGED | PRIORITY_CHANGED
  authorId  String?
  author    User?    @relation("TodoEventAuthor", fields: [authorId], references: [id], onDelete: SetNull)
  fromValue String?
  toValue   String?
  createdAt DateTime @default(now())

  @@index([todoId])
}
```

`Todo.ownerId` garde son nom mais signifie désormais **créateur de la tâche** (relation `owner` conservée).
Les relations inverses sont ajoutées sur `User` (`todoLists`, `todoListMemberships`, `assignedTodos`,
`todoComments`, `todoEvents`) avec les noms de relation ci-dessus.

### Migration PostgreSQL `20261014_todo_lists`

Dossier `server/src/prisma/migrations/20261014_todo_lists/migration.sql`, écrit à la main dans le style
des migrations précédentes (voir `20261008_prospection_module`). Étapes, dans l'ordre :
1. `CREATE TABLE "TodoList"`, `"TodoListMember"`, `"TodoComment"`, `"TodoEvent"` + index + clés étrangères.
2. `ALTER TABLE "Todo" ADD COLUMN "listId" TEXT, ADD COLUMN "assigneeId" TEXT` (nullable à ce stade).
3. **Remplissage** : pour chaque `ownerId` distinct de `"Todo"`, insérer une `TodoList`
   (`name = 'Mes tâches'`, `isPersonal = true`, `ownerId`, `id = md5(random()::text || clock_timestamp()::text || "ownerId")`,
   `updatedAt = CURRENT_TIMESTAMP`), puis `UPDATE "Todo" SET "listId" = (SELECT id FROM "TodoList" WHERE "isPersonal" AND "ownerId" = "Todo"."ownerId")`.
4. `ALTER TABLE "Todo" ALTER COLUMN "listId" SET NOT NULL` + index + clés étrangères (`listId` → Cascade, `assigneeId` → SetNull).

En dev SQLite : `npm run db:push` sur une base vide ou réinitialisée ; le seed crée les listes personnelles.
Les utilisateurs sans tâche n'ont pas de liste personnelle après migration : elle est créée **à la volée**
par le serveur (voir `ensurePersonalList`).

## 4. Règles d'accès

Fonctions pures dans `server/src/services/todoAccess.ts`, testées unitairement :

- `listAccess(list, userId, perms)` → `'none' | 'view' | 'edit' | 'own'` :
  - `own` : `list.ownerId === userId`.
  - sinon membre `EDITOR` → `edit`, membre `VIEWER` → `view`.
  - sinon permission `todos:write_all` → `edit`, `todos:read_all` → `view` (toutes listes, pas seulement personnelles).
  - sinon `none`.
- Une tâche est **visible** si son accès liste ≥ `view` **et** (`!todo.isPrivate || todo.ownerId === userId`).
  Une tâche privée d'autrui renvoie `404 NOT_FOUND` partout, comme aujourd'hui.
- Une tâche est **modifiable** (champs, cocher, commenter, supprimer) si accès liste ≥ `edit` et tâche visible.
- `isPrivate` n'est accepté que dans une liste personnelle **et** par son propriétaire ; ailleurs forcé à `false`.
  Hors de ce cas, un `isPrivate: true` → `400 VALIDATION_ERROR`.
- `assigneeId` doit être un utilisateur ayant accès ≥ `view` à la liste (owner, membre, ou `todos:read_all`), actif ; sinon `400 ASSIGNEE_NOT_ALLOWED`.
- Gestion de la liste (renommer, couleur, membres, supprimer) : `own` uniquement. Liste personnelle :
  renommage et couleur autorisés, membres et suppression → `400 PERSONAL_LIST`.
- Déplacer une tâche (`listId`) exige `edit` sur la liste source **et** sur la liste cible. Une tâche privée
  déplacée hors de la liste personnelle perd `isPrivate`.
- `ensurePersonalList(userId)` : crée « Mes tâches » (`isPersonal: true`) si absente. Appelée dans `GET /todos/lists`.

## 5. API (`server/src/routes/todos.ts`)

Toutes les routes restent derrière `authenticate` + `requirePermission('todos:read')`. Format de réponse unifié.
Les anciens paramètres `userId` (GET) et `ownerId` (POST) sont **supprimés**.

Forme `TodoListDTO` : `{ id, name, color, isPersonal, position, ownerId, owner {id, firstName, lastName}, members [{ userId, role, user {id, firstName, lastName} }], access: 'view'|'edit'|'own', pendingCount, createdAt, updatedAt }`.
Forme `TodoDTO` : champs du modèle + `owner {id, firstName, lastName}` + `assignee {id, firstName, lastName} | null` + `commentCount` + `canEdit: boolean`.
Forme `TodoDetailDTO` : `TodoDTO` + `list { id, name, color, isPersonal }` + `comments [{ id, content, authorId, authorName, author {id, firstName, lastName} | null, createdAt }]` + `events [{ id, type, authorId, author | null, fromValue, toValue, createdAt }]`.

| Méthode | Route | Accès | Effet |
|---|---|---|---|
| GET | `/todos/lists` | `todos:read` | Listes accessibles à l'appelant (personnelle d'abord, puis `position`, puis `name`). Appelle `ensurePersonalList`. |
| POST | `/todos/lists` | `todos:read` | Crée une liste (`name` 1..80, `color?`, `members?: [{userId, role}]`). L'appelant est owner. 201 `TodoListDTO`. |
| PATCH | `/todos/lists/:id` | `own` | `name?`, `color?`, `position?`. |
| PUT | `/todos/lists/:id/members` | `own`, non personnelle | Remplace l'ensemble des membres : `[{ userId, role }]`. Owner ignoré s'il figure dedans, utilisateurs inactifs refusés (`400 MEMBER_NOT_FOUND`). Renvoie `TodoListDTO`. |
| DELETE | `/todos/lists/:id` | `own`, non personnelle | Supprime la liste, ses tâches (cascade) et les notifications liées (`Notification.todoId` des tâches). |
| GET | `/todos` | `todos:read` | Query : `listId?` (sinon toutes les listes accessibles), `status?` (`todo`\|`done`), `priority?`, `assigneeId?` (`me` accepté). Tri inchangé. Tâches privées d'autrui exclues. `data: TodoDTO[]`. |
| GET | `/todos/:id` | visible | `TodoDetailDTO`, commentaires et événements triés par `createdAt` croissant. |
| POST | `/todos` | `edit` sur `listId` | `listId` requis, `title`, `description?`, `priority?`, `dueDate?`, `isPrivate?`, `assigneeId?`. Crée un événement `CREATED` (+ `ASSIGNED` si assigné). 201 `TodoDTO`. |
| PATCH | `/todos/:id` | `edit` | Champs actuels + `listId?` (déplacement) + `assigneeId?` (null pour retirer). Crée les événements : `DONE`/`REOPENED`, `ASSIGNED`/`UNASSIGNED` (`toValue` = id de l'assigné), `MOVED` (`fromValue`/`toValue` = noms des listes), `DUE_CHANGED` (ISO ou null), `PRIORITY_CHANGED`. `TodoDTO`. |
| DELETE | `/todos/:id` | `edit` | Supprime la tâche + ses notifications. |
| POST | `/todos/:id/comments` | `edit` | `{ content }` 1..2000. 201 commentaire. |

Erreurs : `404 NOT_FOUND` (liste ou tâche inexistante ou invisible), `403 FORBIDDEN` (accès insuffisant),
`400 VALIDATION_ERROR`, `400 PERSONAL_LIST`, `400 MEMBER_NOT_FOUND`, `400 ASSIGNEE_NOT_ALLOWED`.

### Scheduler (`runTodoReminders`)
Destinataire de `TODO_REMINDER` / `TODO_DUE` : `todo.assigneeId ?? todo.ownerId`. Lien : `/todos?task=<id>`.
La déduplication par `(todoId, userId, type)` reste.

### Seed (`seed.ts`)
Crée la liste personnelle de chaque utilisateur seedé et rattache les tâches de démo ; ajoute une liste
partagée « Équipe » (owner admin, un membre `EDITOR`, un membre `VIEWER`) avec deux tâches dont une assignée
et un commentaire. Permissions inchangées (`todos:read`, `todos:read_all`, `todos:write_all`), libellés
mis à jour : « Consulter les listes des autres » / « Modifier les listes des autres ».

## 6. Client

### Types (`client/src/types/index.ts`)
`TodoList`, `TodoListMember`, `Todo` (ajout `listId`, `assigneeId`, `assignee`, `commentCount`, `canEdit`),
`TodoDetail`, `TodoComment`, `TodoEvent`, conformes aux DTO du §5.

### Fichiers
- `client/src/pages/todos/TodosPage.tsx` : page, filtres globaux, orchestration des requêtes et du tableau.
- `client/src/pages/todos/TodoBoard.tsx` : conteneur `DragDropContext` horizontal (`@hello-pangea/dnd`, même usage que `PipelinePage`), une `TodoColumn` par liste, colonne fantôme « + Nouvelle liste ».
- `client/src/pages/todos/TodoColumn.tsx` : en-tête (pastille couleur, nom, avatars des membres taille `xs` empilés, compteur à faire, menu ⋯), `Droppable`, cartes, champ d'ajout rapide.
- `client/src/pages/todos/TodoCard.tsx` : `Draggable`, case à cocher, titre, ligne méta.
- `client/src/pages/todos/TodoDrawer.tsx` : panneau latéral de détail (composant `Drawer`, largeur `w-[560px]`).
- `client/src/pages/todos/TodoListModal.tsx` : création / édition d'une liste (nom, couleur, membres avec rôle).
- `client/src/lib/todoThread.ts` : `buildTodoThread(detail): ThreadItem[]` (fonction pure, testée) + `eventLabel`.

### Page et filtres
- En-tête : icône module, titre « Todo », sous-titre « N tâches à faire » (toutes listes), bouton « Nouvelle liste ».
- Filtres : segment À faire / Terminées / Toutes ; case « Assignées à moi ». Plus de sélecteur d'utilisateur.
- Données : `useList(['todos','lists'], '/todos/lists')` et `useList(['todos', filtres], '/todos', { status, assigneeId })`,
  les tâches groupées côté client par `listId`. Invalidation de `['todos']` après chaque mutation.
- `?task=<id>` dans l'URL ouvre le panneau de cette tâche (lien des notifications) ; fermer le panneau retire le paramètre.

### Colonne
- Largeur fixe `w-80`, `flex-shrink-0`, défilement horizontal du conteneur (`overflow-x-auto`, `pb-4`), hauteur de colonne limitée au viewport avec défilement vertical interne.
- En-tête : barre de couleur en haut (`color` → `bg-{color}-500`, neutre `bg-slate-300` ; table de correspondance statique, pas de classe dynamique Tailwind), nom tronqué, avatars membres (max 3 + « +N »), badge compteur, menu ⋯ (Renommer / Membres / Supprimer ; Membres et Supprimer masqués sur la personnelle ; menu réservé à `access === 'own'`).
- Ajout rapide en pied si `access !== 'view'` : champ « + Ajouter une tâche », Entrée crée (`POST /todos` avec `listId`, `title`), Échap vide.
- Colonne vide : texte discret « Aucune tâche ».

### Carte (minimaliste)
- Ligne 1 : case à cocher (désactivée si `!canEdit`), titre (barré si terminée).
- Ligne 2 (seulement si au moins un élément) : badge échéance (rouge en retard, orange ≤ 1 j, gris sinon), pastille priorité (rouge Haute, gris Basse, rien pour Normale), avatar assigné `xs`, icône `MessageSquare` + `commentCount` si > 0, cadenas si privée.
- Clic sur la carte (hors case à cocher) → ouvre le panneau. Glisser vers une autre colonne → `PATCH { listId }` avec mise à jour optimiste du cache et rollback sur erreur. Carte non déplaçable si `!canEdit`.

### Panneau de détail
- Requête `useItem(['todos'], '/todos', id)` → `TodoDetail`.
- Haut : titre (édition inline au clic, Entrée valide), bouton Terminer / Rouvrir, puis grille de champs : Liste (select des listes `access !== 'view'`), Priorité, Échéance, Assigné (membres + owner de la liste, « Personne »), case Privée (visible seulement liste personnelle du propriétaire), Description (textarea, enregistrement au blur). Champs désactivés si `!canEdit`.
- Fil : `buildTodoThread` produit, par ordre chronologique : item `created` (créateur + date, avec description si présente), items `system` (une ligne grise, libellé par `eventLabel` : « a marqué terminée », « a rouvert », « a assigné à X », « a retiré l'assignation », « a déplacé de A vers B », « a changé l'échéance au JJ/MM/AAAA » / « a retiré l'échéance », « a passé la priorité à Haute »), items `comment` (avatar, nom, date relative, contenu `whitespace-pre-wrap`). L'événement `CREATED` n'est pas doublé avec l'item `created`.
- Pied : zone « Ajouter une mise à jour… » (textarea auto-grandissante, Ctrl+Entrée ou bouton Envoyer), masquée si `!canEdit` ; bouton Supprimer (confirmation `Modal`) si `canEdit`.

### Modale de liste
- Nom (requis, 80 max), couleur (palette de 8 pastilles cliquables + « Aucune »), membres : liste des utilisateurs actifs (hors soi) avec un select par ligne « Aucun / Lecture / Édition », section membres masquée pour la liste personnelle.
- Création : `POST /todos/lists` avec `members`. Édition : `PATCH` nom/couleur + `PUT members` si changés.
- Suppression : `Modal` de confirmation précisant que les tâches de la liste seront supprimées.

### Réutilisation
`Drawer`, `Avatar`, `Badge`, `Modal`, `Tooltip`, `toast`, `useList`/`useItem`/`useUsersList`, `usePermission`, `formatDate`, `formatRelative`, `PageIcon`. Style des cartes et colonnes aligné sur `PipelinePage` (DESIGN.md).

## 7. Tests

- Serveur, `tests/unit/todo-access.test.ts` : `listAccess` pour owner, membres, permissions, aucun.
- Serveur, `tests/api/todos.test.ts` réécrit : listes (CRUD, membres, personnelle protégée), accès `view` vs `edit`, tâches privées invisibles, déplacement, assignation refusée hors liste, commentaires, événements générés, `GET /todos/:id`, suppression en cascade des notifications.
- Client, `lib/todoThread.test.ts` : construction du fil, libellés d'événements.
- Vérification : `npm run build` et `npm test` dans `server/`, `npm run build`, `npm run lint`, `npm test` dans `client/`.

## 8. Livraison

Commits par lot (schéma + migration, serveur, client, doc). **Pas de push** avant validation locale par
Clément : tout push sur `master` déploie en production. En prod : `npm run db:migrate:deploy` est joué par le
déploiement ; vérifier ensuite que chaque utilisateur retrouve ses tâches dans « Mes tâches ».
