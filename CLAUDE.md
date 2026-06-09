# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DCRM — CRM interne pour DCB Technologies (entreprise informatique : caisses enregistreuses, matériel, maintenance, sites web).

## Architecture

Deux processus séparés, pas de monorepo build commun :

```
server/   # Express 4 + TypeScript + Prisma 5 + SQLite(dev)/PostgreSQL(prod), port 3001
client/   # React 19 + Vite + TypeScript + Tailwind + shadcn/ui, port 5173
```

En **production**, Express sert le build Vite (`client/dist`) directement — SPA fallback sur `index.html` pour toutes les routes non-API.

## Commands

Toujours lancer depuis le sous-dossier concerné :

| Commande | Répertoire | Effet |
|----------|-----------|-------|
| `npm run dev` | `server/` | API sur :3001 (tsx watch) |
| `npm run dev` | `client/` | UI sur :5173 (Vite HMR) |
| `npm run build` | `server/` | Compile TypeScript → `dist/` |
| `npm run build` | `client/` | `tsc -b && vite build` → `dist/` |
| `npm run lint` | `client/` | ESLint (pas de lint côté server) |
| `npm run db:push` | `server/` | Sync schéma Prisma sans migration (dev) |
| `npm run db:migrate` | `server/` | Crée une migration dev |
| `npm run db:seed` | `server/` | Données démo (admin@crm.local/admin123) |
| `npm run db:studio` | `server/` | Prisma Studio UI |

Variables d'environnement requises au démarrage serveur : `JWT_SECRET`, `JWT_REFRESH_SECRET` (le process s'arrête sans elles).

## Stack Technique

- **Backend** : Express 4, TypeScript, Prisma 5, SQLite dev (`file:./dev.db`) → PostgreSQL prod, Zod **v3**, bcryptjs, node-cron
- **Frontend** : React 19, Vite, TypeScript, Tailwind CSS, Lucide React (icônes), TanStack Query v5, Zustand v5, react-hook-form + Zod **v4**, @hello-pangea/dnd (drag & drop pipeline), Recharts, Leaflet (cartes)

## Conventions de Code

### Réponses API (server)
Toujours retourner le format unifié :
```ts
// Succès
res.json({ success: true, data: T, meta?: { total, page, limit } })
// Erreur
res.json({ success: false, error: { code: 'SNAKE_CASE', message: '...' } })
```

### Middleware Auth (server)
- `authenticate` → vérifie le Bearer token, injecte `req.userId` et `req.userRole`
- `requireRole(['ADMIN', 'MANAGER'])` → garde RBAC sur la route

Rôles : `ADMIN` | `MANAGER` | `COMMERCIAL` | `TECHNICIEN`

### Auth Flow (client)
- Access token (15 min) stocké dans `localStorage` sous la clé `accessToken`
- Refresh token (7j) stocké en **cookie httpOnly** (géré par le serveur, inaccessible au JS)
- L'intercepteur Axios dans `client/src/lib/api.ts` gère automatiquement le refresh sur 401

### Hooks génériques (client)
`client/src/hooks/useApi.ts` expose `useList`, `useItem`, `useCreate`, `useUpdate`, `useDelete` — wrappeurs TanStack Query à réutiliser en priorité plutôt que d'appeler `useQuery`/`useMutation` directement.

### Prisma
- Schéma : `server/src/prisma/schema.prisma`
- Client singleton : `server/src/prisma/client.ts` — toujours importer depuis là, pas instancier un nouveau `PrismaClient`

### Store Zustand
- `client/src/store/authStore.ts` — persiste `user`, `accessToken`, `isAuthenticated` dans `localStorage` (clé `crm-auth`)

## Gotchas

- **Zod version mismatch** : server utilise Zod **v3** (`.error.issues[]`), client utilise Zod **v4** (API légèrement différente). Ne pas mélanger.
- **SQLite vs PostgreSQL** : `DATABASE_URL=file:./dev.db` en dev. Certaines features Prisma (types, JSON natif) diffèrent en prod PostgreSQL — tester les migrations sur les deux si possible.
- `db:push` (sans migration) pour le dev rapide ; `db:migrate` crée un fichier de migration versionné à committer.
- Le **scheduler** (`server/src/scheduler.ts`) démarre automatiquement au boot — contrats expirant, alertes garantie équipements, notifications automatiques.
- L'**automation engine** (`server/src/automation-engine.ts`) évalue les règles d'automatisation enregistrées en DB.
- Pas de devis/factures dans l'app (géré via Pennylane externe) malgré les routes présentes dans `API.md`.

## Référence Rapide

- **Modèle de données** : `PLAN.md` (section "Modèle de Données Principal")
- **État d'avancement par page** : `PROGRESS.md`
- **Design system** (couleurs, layout, badges statuts) : `DESIGN.md`
- **Tous les endpoints REST** : `API.md`
- **Historique des sessions** : `JOURNAL.md`
