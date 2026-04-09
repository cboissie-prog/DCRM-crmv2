# DCRM crmv2

CRM interne pour DCB Technologies — stack React/Node séparés (pas Next.js).

## Architecture

```
crmv2/
  server/   # Express + Prisma + SQLite(dev)/PostgreSQL(prod), port 3001
  client/   # React 19 + Vite + Tailwind + shadcn/ui, port 5173
  PLAN.md      # Architecture & stack
  FEATURES.md  # Fonctionnalités détaillées
  API.md       # Endpoints REST
  DESIGN.md    # Design system (couleurs, typo, composants)
  PROGRESS.md  # Suivi d'avancement par module
```

## Commands

| Commande | Contexte |
|----------|---------|
| `npm run dev` | server/ → API sur :3001 |
| `npm run dev` | client/ → UI sur :5173 |
| `npm run db:push` | server/ → sync schéma Prisma sans migration |
| `npm run db:seed` | server/ → données de démo |
| `npm run db:studio` | server/ → UI Prisma |

## Stack

- **Backend** : Express 4, TypeScript, Prisma 5, SQLite (dev) → PostgreSQL (prod), JWT (15m + refresh 7j), Zod v3
- **Frontend** : React 19, Vite, TypeScript, Tailwind, shadcn/ui, TanStack Query, Zustand
- **Auth** : JWT stateless, bcryptjs, rôles ADMIN/MANAGER/COMMERCIAL/TECHNICIEN

## Code Conventions

- Server Actions retournent `{ success: true, data: T } | { success: false, error: string }`
- Schéma Prisma : `server/src/prisma/schema.prisma`
- Client Prisma singleton : `server/src/prisma/client.ts`
- Types partagés front/back : `shared/types/` (à créer si besoin)
- Routes : `server/src/routes/`, Controllers : `server/src/controllers/`
- Composants : `client/src/components/`, Pages : `client/src/pages/`

## Gotchas

- `DATABASE_URL=file:./dev.db` en dev (SQLite) — adapter pour PostgreSQL en prod
- Zod v3 : `.safeParse()` retourne `{ success, data }` ou `{ success: false, error }` avec `.error.issues`
- Pas de devis/factures — géré via Pennylane (outil externe)
- Avancement : `PROGRESS.md` (état actuel) · `JOURNAL.md` (historique sessions)
