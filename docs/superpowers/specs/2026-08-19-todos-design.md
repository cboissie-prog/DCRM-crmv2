# Design — Module Todo (todolist par utilisateur)

Date : 2026-08-19
Statut : en attente de validation utilisateur

## Objectif

Nouvel onglet « Todo » dans le CRM : chaque utilisateur gère sa propre todolist. Selon les permissions de son rôle, un utilisateur peut consulter (et éventuellement modifier) les todolists des autres via un menu déroulant. Une tâche peut être marquée **privée** : elle n'est alors visible que par son propriétaire, quel que soit le rôle de l'observateur (y compris ADMIN). Une tâche peut porter une **deadline facultative** déclenchant deux rappels en notification in-app : **J-1** et **jour J**.

## Approches considérées

- **A (retenue)** : nouveau modèle Prisma `Todo` dédié + route `/api/todos` + page `TodosPage`, en suivant les patterns existants (licenses/references). Propre, isolé, testable.
- **B (écartée)** : raviver le modèle `Activity` (type `TASK`). Écartée : le module Activités a été retiré (permissions supprimées du seed, aucune route), sémantique différente (lié aux entités CRM, pas à un utilisateur propriétaire).
- **C (écartée)** : stocker les todos côté client (localStorage). Écartée : pas de partage inter-utilisateurs ni de rappels serveur possibles.

## Modèle de données

Dans `server/src/prisma/schema.prisma` **et** `server/src/prisma/schema.postgres.prisma` (les deux fichiers doivent rester synchronisés) :

```prisma
// priority: LOW | NORMAL | HIGH
model Todo {
  id          String    @id @default(uuid())
  title       String
  description String?
  priority    String    @default("NORMAL")
  isDone      Boolean   @default(false)
  isPrivate   Boolean   @default(false)
  dueDate     DateTime?
  completedAt DateTime?
  ownerId     String
  owner       User      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

- Relation inverse `todos Todo[]` sur `User`.
- Ajout du champ `todoId String?` sur `Notification` (même pattern que `appointmentId`) pour le dédoublonnage des rappels et le nettoyage à la suppression d'une tâche.
- Pas d'enum Prisma natif (convention du projet : `String` documenté en commentaire).

## Permissions

Trois nouvelles permissions (catégorie « Todo ») dans le seed (`server/src/prisma/seed.ts`) :

| Clé | Effet | Attribution par défaut |
|-----|-------|------------------------|
| `todos:read` | Accès au module : voir et gérer (CRUD) **sa propre** liste | Tous les rôles |
| `todos:read_all` | Consulter la liste des autres utilisateurs (lecture seule) | ADMIN, MANAGER |
| `todos:write_all` | Ajouter/modifier/cocher/supprimer des tâches dans la liste des autres | ADMIN, MANAGER |

- ADMIN passe par le bypass `'*'` existant.
- MANAGER : les clés ne sont pas ajoutées à sa liste d'exclusions (il reçoit `allKeys` moins exclusions) → il obtient les trois.
- COMMERCIAL et TECHNICIEN : ajout de `todos:read` uniquement dans leurs listes explicites.
- Ajustable par rôle via l'écran Réglages > Rôles existant (aucun dev supplémentaire).

**Règle de confidentialité absolue** : une tâche `isPrivate` n'est renvoyée par l'API **que** si `ownerId === req.userId`. Ce filtre est basé sur la propriété, pas sur les permissions — le bypass ADMIN `'*'` ne le contourne pas.

## API — `server/src/routes/todos.ts` (montée sur `/api/todos` dans `app.ts`)

Gabarit identique à `references.ts`/`licenses.ts` : `router.use(authenticate)`, Zod v3, réponses `{ success, data, meta? }`, `handleRouteError`.

| Méthode | Route | Permission | Description |
|---------|-------|-----------|-------------|
| GET | `/todos?userId=&status=&priority=` | `todos:read` (+ `todos:read_all` si `userId` ≠ soi) | Liste des tâches du propriétaire ciblé (soi par défaut). Les tâches privées d'autrui sont **toujours exclues**. Tri : non faites d'abord, puis priorité (HIGH→LOW), puis dueDate croissante (nulles en dernier). |
| POST | `/todos` | `todos:read` (+ `todos:write_all` si `ownerId` ≠ soi) | Crée une tâche. Si créée pour un autre utilisateur : `isPrivate` forcé à `false` (on ne crée pas une tâche qu'on ne pourrait plus voir) ; vérification que l'owner existe et est actif. |
| PATCH | `/todos/:id` | propriétaire, sinon `todos:write_all` | Modifie titre/description/priorité/dueDate/isPrivate/isDone. `isDone: true` renseigne `completedAt` (et le vide au décochage). Une tâche privée d'autrui répond `404 NOT_FOUND` (ne pas révéler son existence). Seul le propriétaire peut passer une tâche en privée. Changement d'owner non supporté (hors périmètre). |
| DELETE | `/todos/:id` | propriétaire, sinon `todos:write_all` | Supprime la tâche **et** ses notifications liées (`deleteMany({ todoId })`). Privée d'autrui → `404`. |

Validation Zod : `title` 1–200 car., `description` ≤ 2000 car. optionnelle, `priority` ∈ LOW/NORMAL/HIGH, `dueDate` datetime ISO nullable, `isPrivate`/`isDone` booléens.

## Rappels — scheduler

Nouvelle fonction `runTodoReminders()` dans `server/src/scheduler.ts`, appelée par le cron horaire existant (`0 * * * *`, Europe/Paris) :

- Cible : tâches `isDone: false` avec `dueDate` non nulle.
- **Rappel J-1** (`type: 'TODO_REMINDER'`) : créé quand `now >= dueDate - 24h` et `now < dueDate`. Message : « "{titre}" arrive à échéance demain ».
- **Rappel jour J** (`type: 'TODO_DUE'`) : créé quand `now >= dueDate`. Message : « "{titre}" arrive à échéance aujourd'hui ».
- Destinataire : le **propriétaire** uniquement (tâches privées comprises — la notification ne fuite chez personne d'autre). `link: '/todos'`.
- Dédoublonnage : `findFirst({ where: { todoId, userId, type } })` avant `create` (pattern exact de `runAppointmentReminders`).
- Une tâche créée déjà en retard reçoit au plus un rappel de chaque type (dédup) — comportement accepté.
- Le champ dueDate est saisi comme date (minuit heure locale) : les notifications apparaissent donc dès le début de la journée concernée, au prochain passage du cron.

Côté client, ajout des types `TODO_REMINDER` / `TODO_DUE` dans le mapping d'icônes de `Header.tsx` (icône ListTodo).

## Client

- **Page** `client/src/pages/todos/TodosPage.tsx`, route `/todos` protégée par `ProtectedRoute permission="todos:read"` dans `App.tsx` (lazy import).
- **Sidebar** (`Sidebar.tsx`) : item top-level `{ label: 'Todo', icon: <ListTodo/>, to: '/todos' }`. Ajout du support d'un champ `permission?` sur les items top-level (aujourd'hui seuls les enfants l'ont), filtré via `hasPermission` — amélioration ciblée réutilisable.
- **Sélecteur d'utilisateur** : si `todos:read_all`, menu déroulant en tête de page « Ma liste » + utilisateurs actifs (`useUsersList()`). Sinon, pas de sélecteur.
- **Liste** : filtres À faire / Terminées / Toutes ; ligne = case à cocher (toggle isDone, barré si fait), titre + description repliée, badge priorité (HIGH rouge, NORMAL bleu, LOW gris), badge échéance (rouge si dépassée, orange si aujourd'hui/demain), icône cadenas si privée. Boutons éditer/supprimer selon droits (sa liste, ou liste d'autrui + `todos:write_all`).
- **Formulaire** (Modal + react-hook-form + Zod v4) : titre, description, priorité, deadline (input date, facultative), case « Tâche privée » (masquée quand on crée/édite pour un autre utilisateur).
- Hooks génériques `useList`/`useCreate`/`useUpdate`/`useDelete` de `useApi.ts` ; toasts sur succès/erreur ; état vide illustré.

## Documentation & tests

- **API.md** : nouvelle section `### Todo `/api/todos`` au gabarit standard (tableau + détails par endpoint) ; **openapi.json** mis à jour en parallèle.
- **Tests** `server/tests/api/todos.test.ts` (Vitest + Supertest, `createApp({ rateLimit: false })`, `loginAs`) :
  - CRUD sur sa propre liste.
  - Une tâche privée n'apparaît jamais pour un autre utilisateur (même ADMIN) ; PATCH/DELETE dessus → 404.
  - `GET ?userId=autre` refusé sans `todos:read_all` (403) ; accepté avec.
  - POST pour autrui refusé sans `todos:write_all` ; accepté avec, `isPrivate` forcé à `false`.
  - `isDone` → `completedAt` renseigné/vidé.
  - Dédoublonnage des rappels (appel direct de `runTodoReminders()` deux fois → une seule notification par type).

## Déploiement (à noter pour la prod)

- Migration Prisma à créer (`db:migrate`) — nouveau modèle `Todo` + colonne `Notification.todoId`.
- Seed prod à rejouer pour créer les 3 permissions et leurs attributions aux rôles (s'ajoute aux seeds déjà en attente listés en mémoire).

## Hors périmètre (YAGNI)

Sous-tâches, réassignation d'une tâche existante, tags/catégories, récurrence, rappels par email, ordre manuel drag & drop, commentaires.
