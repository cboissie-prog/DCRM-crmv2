# Journal des Sessions de Développement

## Session 1 — 2026-04-07
- Plan validé : devis/factures retirés (Pennylane), ajout parc informatique, licences, MRR/ARR, scoring leads, NPS, alertes churn, automatisations, base de connaissance, cartographie
- Création des fichiers PLAN.md, FEATURES.md, API.md, DESIGN.md, PROGRESS.md
- Initialisation `server/` : Express + Prisma 5 + SQLite + JWT + Zod
- Schéma Prisma complet (20+ modèles)
- Initialisation `client/` : Vite + React 19 + Tailwind

## Session 2 — 2026-04-07
- `db:push` + seed complet : 4 users, 8 entreprises, 8 contacts, 15 produits, 6 contrats, 8 équipements, 6 licences, 6 opportunités, 6 tickets
- Toutes les routes backend vérifiées et complètes (15 fichiers)
- Login admin@crm.local/admin123 vérifié (JWT retourné)

## Session 3 — 2026-04-07
- Dépendances frontend installées : react-router-dom, zustand, axios, react-hook-form, zod, lucide-react, @tanstack/react-query, recharts...
- App.tsx réécrit : routing complet, lazy loading (bundle 200KB vs 1MB)
- Fix build : react-beautiful-dnd → @hello-pangea/dnd (compat React 19), react-is installé

## Session 4 — 2026-04-07
- RBAC backend : middleware `requireRole`, matrice permissions sur 12 fichiers de routes
- Pipeline Kanban : drag & drop @hello-pangea/dnd, 4 colonnes + WON/LOST archives, stats
- Page Leads : scoring + conversion en opportunité
- Page Tickets : liste + détail + chronomètre + commentaires internes/publics
- Page Gestion Utilisateurs : CRUD, rôles, désactivation (soft delete)

## Session 5 — 2026-04-08
- Pages Contrats, Parc informatique, Licences (CRUD + permissions + alertes)
- Fiche Entreprise : 6 onglets (Infos, Contacts, Opportunités, Tickets, Contrats, Équipements)
- Edit/Delete sur Contacts et Entreprises (pages liste)
- Dashboard connecté API réelle (stats, revenue chart, churn risks)
- Page Paramètres : profil, mot de passe, config entreprise (localStorage)
- Page Agenda : calendrier mensuel custom CSS Grid, multi-select participants
- Base de connaissance : cards + panel détail inline + CRUD
- NPS : score global + promoteurs/passifs/détracteurs + liste réponses
- Automatisations : UI complète (cards + toggle actif + exemples) — **API backend manquante**
- Activités/Timeline : chronologique avec icônes par type + filtres
- Avatar component : ajout size `xs`
- Fix build : imports inutilisés, `_prefilledDate`, zodResolver casts
