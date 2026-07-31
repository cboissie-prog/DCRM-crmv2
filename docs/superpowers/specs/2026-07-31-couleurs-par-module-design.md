# Design — Code couleur par module

**Date :** 2026-07-31
**Statut :** validé par Clément (avec exigence : configuration centralisée des couleurs)

## Objectif

L'interface du CRM est monochrome (tout en `slate` + un seul accent `primary` indigo).
Ajouter des touches de couleur pour rendre l'UI plus vivante et aider au repérage,
sans surcharger : la couleur s'applique aux pictos et pastilles, jamais aux contenus
(tableaux, formulaires, boutons inchangés).

## Décisions validées

1. **Stratégie :** code couleur par module métier (chaque domaine a sa couleur).
2. **Périmètre :** sidebar + dashboard + en-têtes de pages. Le reste ne bouge pas.
3. **Style sidebar :** icône colorée simple (trait coloré, pas de fond).
4. **Configuration centralisée :** changer la couleur d'un module = modifier
   **une seule ligne** dans un fichier de config ; tout le reste suit.

## Palette par module

| Clé module   | Couleur Tailwind | Sections couvertes                                        |
|--------------|------------------|-----------------------------------------------------------|
| `dashboard`  | `indigo`         | Tableau de bord, Rapports                                  |
| `calls`      | `sky`            | Appels                                                     |
| `commercial` | `emerald`        | Pipeline, Leads, Objectifs & Prévisions                    |
| `agenda`     | `violet`         | Agenda & Interventions                                     |
| `contacts`   | `blue`           | Contacts, Entreprises, Cartographie                        |
| `parc`       | `cyan`           | Parc clients, Équipements, Licences, Contrats              |
| `tickets`    | `amber`          | Tickets SAV                                                |
| `tools`      | `fuchsia`        | Catalogue, Base de connaissance, Automatisations, NPS, Utilisateurs, Rôles |

Notifications et Paramètres restent neutres (`slate`), comme aujourd'hui.

## Architecture

### 1. Fichier de config : `client/module.colors.js` (source de vérité unique)

```js
import colors from 'tailwindcss/colors'

// Changer la couleur d'un module = changer la valeur ici, rien d'autre.
export const moduleColors = {
  dashboard:  colors.indigo,
  calls:      colors.sky,
  commercial: colors.emerald,
  agenda:     colors.violet,
  contacts:   colors.blue,
  parc:       colors.cyan,
  tickets:    colors.amber,
  tools:      colors.fuchsia,
}
```

### 2. `tailwind.config.js` importe ce fichier

Les palettes sont exposées sous l'espace de noms `module-*` :

```js
colors: {
  primary: { ... }, // inchangé
  'module-dashboard':  moduleColors.dashboard,
  'module-calls':      moduleColors.calls,
  // ... etc.
}
```

Le code utilise donc des classes **sémantiques et statiques** :
`text-module-tickets-600`, `bg-module-commercial-50`, etc.
Elles sont écrites en dur dans les sources (compatibles avec le purge Tailwind),
mais leur valeur réelle vient de `module.colors.js`. Changer une ligne dans la
config change la couleur partout après rebuild.

### 3. Helper front : `client/src/lib/moduleTheme.ts`

Un map TypeScript `ModuleKey → { icon, bg, text, activeBg, activeText }` avec les
noms de classes statiques, ex. :

```ts
export const moduleTheme = {
  tickets: {
    icon: 'text-module-tickets-600',
    bg: 'bg-module-tickets-50',
    text: 'text-module-tickets-700',
    ...
  },
  ...
}
```

Sidebar, dashboard et en-têtes consomment uniquement ce helper.

### 4. Composant `PageIcon` : `client/src/components/ui/PageIcon.tsx`

Petit carré arrondi (≈ 40 px, fond teinte 50, icône teinte 600) affiché à gauche
du `page-title`. Props : `module` (clé) + `icon` (ReactNode lucide).

## Application

### Sidebar (`Sidebar.tsx`)

- Chaque entrée de `navItems` gagne un champ `module: ModuleKey`.
- L'icône reçoit `moduleTheme[module].icon` (trait coloré, pas de fond).
- Texte et hover inchangés (gris).
- État actif d'un item ou sous-item : teinte du module (`bg-module-X-50 text-module-X-700`)
  au lieu de l'indigo générique actuel.

### Dashboard (`DashboardPage.tsx`)

- `KpiCard` accepte une prop `module` ; la pastille (actuellement
  `bg-primary-50 text-primary-600`) devient `bg-module-X-50 text-module-X-600`.
  Attribution : CA / pipeline → `commercial`, contacts → `contacts`,
  tickets → `tickets`, RDV → `agenda`, etc. selon les KPI existants.
- Les pastilles des listes (deals récents, tickets récents, prochains RDV)
  s'alignent sur la palette du module correspondant. La sémantique d'alerte
  reste prioritaire (ex. RDV en retard reste rouge).

### En-têtes de pages (~20 pages de liste)

- Ajout de `<PageIcon module="..." icon={...} />` à côté du `page-title` sur les
  pages : Dashboard, Rapports, Appels, Pipeline, Leads, Objectifs, Agenda,
  Contacts, Entreprises, Parc, Équipements, Licences, Contrats, Tickets,
  Catalogue, Base de connaissance, Automatisations, NPS, Utilisateurs, Rôles.
- Les pages de détail (fiche contact, fiche entreprise, détail ticket, parc client)
  gardent leur en-tête actuel sans icône.
- Notifications et Paramètres : pas d'icône colorée (restent neutres).

## Ce qui ne change pas

- Tableaux, formulaires, boutons, badges (déjà colorés), modales, toasts.
- La palette `primary` (indigo) reste la couleur de marque : boutons primaires,
  focus rings, logo.
- Aucune logique métier, aucun changement serveur, aucune permission RBAC touchée
  (changement purement visuel — la règle « routes + seed + UI permissions »
  ne s'applique pas ici).

## Gestion des erreurs / risques

- **Purge Tailwind :** aucune classe construite dynamiquement par template string ;
  toutes les classes `module-*` sont écrites en littéral dans `moduleTheme.ts`.
- **Contraste :** teintes 600/700 sur fond 50 = contraste AA garanti pour toutes
  les palettes Tailwind retenues.
- **Dark mode :** `darkMode: 'class'` est configuré mais non utilisé dans l'app ;
  hors périmètre.

## Tests

- `npm run build` (tsc + vite) doit passer.
- `npm run test` (vitest) doit rester vert.
- Vérification visuelle : sidebar, dashboard, 2–3 pages représentatives.
