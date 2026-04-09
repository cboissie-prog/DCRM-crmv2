# Guide de Design du CRM

## Identité Visuelle

### Palette de Couleurs

| Rôle              | Couleur          | Hex       |
|-------------------|------------------|-----------|
| Primaire          | Indigo            | #4F46E5   |
| Primaire hover    | Indigo foncé      | #4338CA   |
| Secondaire        | Slate             | #64748B   |
| Succès            | Emeraude          | #10B981   |
| Avertissement     | Ambre             | #F59E0B   |
| Danger            | Rouge             | #EF4444   |
| Info              | Bleu ciel         | #0EA5E9   |
| Background (light)| Gris très clair   | #F8FAFC   |
| Background (dark) | Gris très foncé   | #0F172A   |
| Surface (light)   | Blanc             | #FFFFFF   |
| Surface (dark)    | Gris foncé        | #1E293B   |
| Texte principal   | Slate 900         | #0F172A   |
| Texte secondaire  | Slate 500         | #64748B   |

### Typographie
- **Police principale** : Inter (Google Fonts)
- **Titres** : 600-700 weight
- **Corps** : 400 weight
- **Petits labels** : 500 weight, uppercase, letter-spacing

### Iconographie
- **Bibliothèque** : Lucide React
- Taille standard : 16px (small), 20px (medium), 24px (large)

---

## Layout Principal

```
┌─────────────────────────────────────────────────────┐
│  HEADER : Logo | Recherche globale | Notifs | Avatar │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ SIDEBAR  │         CONTENU PRINCIPAL                │
│ (fixe,   │                                          │
│ 240px)   │  Breadcrumb                              │
│          │  ─────────────────────────────────────   │
│ Nav items│  Contenu de la page                      │
│          │                                          │
│          │                                          │
│          │                                          │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### Sidebar Navigation
```
● Dashboard
─────────────────
● Contacts
  ├ Tous les contacts
  └ Entreprises
● Commercial
  ├ Pipeline
  ├ Leads
  └ Opportunités
● Catalogue
  ├ Produits
  └ Services
● Documents
  ├ Devis
  └ Factures
● Contrats
● Support
● Agenda
─────────────────
● Rapports
● Paramètres
```

---

## Composants UI

### Cards de données
- Border-radius : 12px
- Shadow : `0 1px 3px rgba(0,0,0,0.1)`
- Padding : 24px
- Header card : titre + action (bouton ou menu)

### Tableaux de données
- Header avec tri par colonne
- Pagination (25/50/100 par page)
- Recherche inline
- Sélection multiple + actions groupées
- Skeleton loading
- États vides illustrés

### Formulaires
- Labels au-dessus des champs
- Messages d'erreur en rouge sous le champ
- Bouton principal plein, bouton secondaire outline
- Modales pour créations/éditions rapides
- Pages complètes pour fiches détaillées

### Statuts (badges colorés)
- Pipeline : Nouveau (gris), Qualification (bleu), Proposition (violet), Négociation (orange), Gagné (vert), Perdu (rouge)
- Devis : Brouillon (gris), Envoyé (bleu), Accepté (vert), Refusé (rouge), Expiré (orange)
- Factures : En attente (jaune), Payée (vert), En retard (rouge)
- Tickets : Nouveau (gris), En cours (bleu), Résolu (vert), Critique (rouge)

### KPI Cards (Dashboard)
- Icône colorée + valeur large + label + variation vs période précédente
- Couleur verte si hausse positive, rouge si baisse

---

## Pages Clés

### Dashboard
- Grid 4 colonnes (KPIs)
- Graphique CA sur 12 mois (barre)
- Pipeline par étapes (funnel ou barre empilée)
- Tableau activités récentes
- Mini-liste tickets urgents
- Agenda du jour

### Vue Contacts
- Barre de recherche + filtres rapides (tags, statut, source)
- Toggle vue liste / vue cards
- Clic → fiche détaillée avec tabs (Infos, Activités, Devis, Factures, Tickets)

### Pipeline Kanban
- Colonnes glissables (drag & drop)
- Cards avec avatar client, valeur, date closing, responsable
- Filtres par commercial, période

### Devis / Factures
- Éditeur de lignes interactif (ajout/suppression)
- Prévisualisation en temps réel
- Export PDF direct

---

## Responsive
- Desktop : Layout complet avec sidebar
- Tablet (768px-1024px) : Sidebar collapsible
- Mobile : Bottom navigation (Phase 3 React Native)
