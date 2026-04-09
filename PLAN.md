# CRM - Plan Général du Projet

## Contexte Métier

Logiciel CRM pour une entreprise informatique vendant :
- **Caisses enregistreuses** (vente, installation, SAV)
- **Matériel informatique** (PCs, périphériques, réseaux)
- **Maintenance informatique** (contrats, interventions)
- **Sites web** (création, hébergement, maintenance)

---

## Architecture Cible

```
Web App (React)  →  API REST (Node.js/Express)  →  PostgreSQL
       ↓
Mobile App (React Native) — Phase 2
```

### Stack Technique

| Couche        | Technologie                         | Raison                              |
|---------------|-------------------------------------|-------------------------------------|
| Frontend      | React 18 + TypeScript + Vite        | Performances, typage fort           |
| UI            | TailwindCSS + shadcn/ui             | Design system cohérent              |
| Charts        | Recharts                            | Graphiques performants              |
| State         | TanStack Query + Zustand            | Cache serveur + état global         |
| Backend       | Node.js + Express + TypeScript      | Unifié JS full-stack                |
| ORM           | Prisma                              | Type-safe, migrations propres       |
| Base de données | SQLite (dev) → PostgreSQL (prod)  | Simple démarrage, scalable          |
| Auth          | JWT + refresh tokens                | Stateless, mobile-compatible        |
| Validation    | Zod                                 | Partagé front/back                  |
| Email         | Nodemailer                          | Notifications et envoi devis        |
| PDF           | Puppeteer / pdfkit                  | Génération devis/factures           |

---

## Structure du Projet

```
crmv2/
├── PLAN.md
├── FEATURES.md
├── PROGRESS.md
├── DESIGN.md
├── API.md
├── client/               # React frontend
│   ├── src/
│   │   ├── components/   # Composants réutilisables
│   │   ├── pages/        # Pages de l'app
│   │   ├── hooks/        # Custom hooks
│   │   ├── store/        # Zustand store
│   │   ├── lib/          # Utilitaires, API client
│   │   └── types/        # Types TypeScript
│   └── package.json
├── server/               # Node.js backend
│   ├── src/
│   │   ├── routes/       # Routes API
│   │   ├── controllers/  # Logique métier
│   │   ├── middleware/   # Auth, validation
│   │   ├── services/     # Services (email, PDF)
│   │   └── prisma/       # Schema + migrations
│   └── package.json
└── shared/               # Types partagés
    └── types/
```

---

## Phases de Développement

### Phase 1 — MVP Fonctionnel (priorité)
1. Auth & gestion des utilisateurs
2. Contacts & clients (entreprises + particuliers)
3. Pipeline commercial (leads → opportunités → deals)
4. Catalogue produits/services
5. Devis & factures (génération PDF)
6. Dashboard avec KPIs clés

### Phase 2 — Fonctionnalités Avancées
7. Contrats de maintenance (récurrents)
8. Support & tickets SAV
9. Agenda & interventions
10. Rapports & analytics avancés
11. Notifications & alertes

### Phase 3 — Mobile (React Native)
12. Application iOS & Android
13. Mode hors-ligne
14. Notifications push

---

## Design System

- **Thème** : Clair par défaut, mode sombre disponible
- **Palette** : Bleu indigo principal (#4F46E5), accents verts pour succès, rouges pour alertes
- **Police** : Inter (moderne, lisible)
- **Layout** : Sidebar fixe gauche + header + contenu principal
- **Densité** : Compacte mais aérée (idéal pour usage professionnel)

---

## Modèle de Données Principal

- `User` — Employés (admin, commercial, technicien)
- `Contact` — Clients (entreprise ou particulier)
- `Company` — Entreprises clientes
- `Lead` — Prospects
- `Opportunity` — Opportunités commerciales
- `Deal` — Ventes conclues
- `Product` — Catalogue (matériel, services, caisses, sites)
- `Quote` — Devis avec lignes
- `Invoice` — Factures
- `Contract` — Contrats maintenance/hébergement
- `Ticket` — Support SAV
- `Activity` — Historique (appels, emails, RDV, notes)
- `Appointment` — Agenda / interventions
