# Suivi d'Avancement — DCRM crmv2

**Statut global : 🟡 Phase 3/4 en cours**
**Légende :** 🟢 Fait · 🟡 Partiel · 🔴 Todo · ⚠️ Bloqué

---

## Fondations

| Module | Statut | Notes |
|--------|--------|-------|
| Serveur Express + Prisma + JWT | 🟢 | port 3001, SQLite dev |
| Schéma Prisma (20+ modèles) | 🟢 | voir `server/src/prisma/schema.prisma` |
| Auth JWT (login/refresh/logout/me) | 🟢 | |
| RBAC backend (middleware + matrice) | 🟢 | 4 rôles : ADMIN/MANAGER/COMMERCIAL/TECHNICIEN |
| Seed données démo | 🟢 | admin@crm.local/admin123, jean.dupont@crm.local/test123 |
| Client React 19 + Vite + Tailwind | 🟢 | port 5173, lazy loading, bundle 200KB |
| Layout sidebar + header + routing | 🟢 | filtrage nav par rôle |

---

## Pages Frontend

| Page | Route | Frontend | Backend | CRUD complet |
|------|-------|----------|---------|--------------|
| Login | `/login` | 🟢 | 🟢 | — |
| Dashboard | `/` | 🟢 | 🟢 | — |
| Contacts (liste) | `/contacts` | 🟢 | 🟢 | 🟢 create/edit/delete |
| Contact (fiche) | `/contacts/:id` | 🟢 | 🟢 | 🟢 edit/delete |
| Entreprises (liste) | `/companies` | 🟢 | 🟢 | 🟢 create/edit/delete |
| Entreprise (fiche) | `/companies/:id` | 🟢 | 🟢 | 🟢 edit/delete + 6 onglets |
| Pipeline Kanban | `/pipeline` | 🟢 | 🟢 | 🟢 drag&drop + edit/delete |
| Leads & Scoring | `/leads` | 🟢 | 🟢 | 🟢 + conversion |
| Tickets SAV | `/tickets` | 🟢 | 🟢 | 🟢 chrono + commentaires |
| Contrats | `/contracts` | 🟢 | 🟢 | 🟢 |
| Parc informatique | `/equipment` | 🟢 | 🟢 | 🟢 alertes garantie |
| Licences | `/licenses` | 🟢 | 🟢 | 🟢 alertes expiration |
| Agenda | `/appointments` | 🟢 | 🟢 | 🟢 calendrier custom |
| Activités / Timeline | `/activities` | 🟢 | 🟢 | 🟢 |
| Base de connaissance | `/knowledge` | 🟢 | 🟢 | 🟢 |
| NPS / Satisfaction | `/nps` | 🟢 | 🟢 | lecture seule |
| Notifications | `/notifications` | 🟢 | 🟢 | dropdown header + page complète |
| Gestion utilisateurs | `/users` | 🟢 | 🟢 | 🟢 CRUD + rôles |
| Paramètres | `/settings` | 🟢 | 🟢 | profil + mdp + entreprise DB (SIRET, TVA, logo…) + système |
| Automatisations | `/automations` | 🟢 | 🟢 | 🟢 CRUD complet |
| Catalogue produits | `/products` | 🟢 | 🟢 | 🟢 CRUD (désactivation soft) |
| Cartographie Maps | `/companies/map` | 🟢 | 🟢 | Leaflet + OSM, marqueurs par secteur, panel latéral |

---

## Fonctionnalités manquantes / Todo

| Fonctionnalité | Priorité | Notes |
|----------------|----------|-------|
| **Cartographie Google Maps** | 🟢 Fait | Leaflet + OpenStreetMap, zéro API key |
| **Objectifs & quotas commerciaux** | 🟢 Fait | Page /targets onglet Objectifs, CRUD ADMIN/MANAGER |
| **Prévisions commerciales** | 🟢 Fait | Page /targets onglet Prévisions, pipeline pondéré |
| **Export CSV** | 🟡 Moyenne | Sur contacts, entreprises, tickets |
| **Notifications in-app** | 🟡 Moyenne | API backend OK, header a juste un compteur |
| **Mobile React Native** | 🔴 Basse | Phase 5 |
