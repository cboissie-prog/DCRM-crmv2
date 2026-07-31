# Code couleur par module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colorer les pictos de la sidebar, les pastilles KPI du dashboard et les en-têtes de pages selon un code couleur par module métier, piloté par un fichier de config unique.

**Architecture:** Un fichier `client/module.colors.js` (source de vérité) mappe chaque module vers une palette Tailwind. `tailwind.config.js` l'importe et expose les palettes sous l'espace de noms `module-*`. Un helper `src/lib/moduleTheme.ts` fournit les noms de classes statiques ; sidebar, dashboard et le composant `PageIcon` consomment uniquement ce helper.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS 3.4, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-31-couleurs-par-module-design.md`

## Global Constraints

- Les couleurs réelles ne sont nommées **que** dans `client/module.colors.js`. Partout ailleurs : classes sémantiques `*-module-<clé>-<teinte>` uniquement.
- Aucune classe Tailwind construite dynamiquement par template string (purge). Toutes les classes sont des littéraux dans `moduleTheme.ts`.
- Modules et palettes : `dashboard`=indigo, `calls`=sky, `commercial`=emerald, `agenda`=violet, `contacts`=blue, `parc`=cyan, `tickets`=amber, `tools`=fuchsia.
- Notifications, Paramètres, pages de détail (fiche contact/entreprise/ticket/parc client, détail appel), CompanyMapPage : **inchangés** (neutres).
- La page « Rapports » n'existe pas (pas de route `/reports`, dossier vide) : hors périmètre.
- Tableaux, formulaires, boutons, badges, logique métier, serveur : intouchés.
- Tous les chemins ci-dessous sont relatifs à la racine du repo. Les commandes s'exécutent dans `client/`.
- Suppression de fichiers : `trash`, jamais `rm -rf`.
- Fin de chaque message de commit : `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Système de thème (config + Tailwind + helper)

**Files:**
- Create: `client/module.colors.js`
- Create: `client/module.colors.d.ts`
- Modify: `client/tailwind.config.js`
- Create: `client/src/lib/moduleTheme.ts`
- Test: `client/src/lib/moduleTheme.test.ts`

**Interfaces:**
- Consumes: rien (fondation).
- Produces:
  - `moduleColors: Record<string, Record<string, string>>` (export nommé de `module.colors.js`)
  - `type ModuleKey = 'dashboard' | 'calls' | 'commercial' | 'agenda' | 'contacts' | 'parc' | 'tickets' | 'tools'`
  - `moduleTheme: Record<ModuleKey, { icon: string; bg: string; activeBg: string; activeText: string }>` (exports de `src/lib/moduleTheme.ts`)
  - Classes Tailwind générées : `text-module-<clé>-{400,500,600,700}`, `bg-module-<clé>-{50,100,400}` etc. pour les 8 clés.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `client/src/lib/moduleTheme.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { moduleColors } from '../../module.colors.js'
import { moduleTheme } from './moduleTheme'

const EXPECTED_KEYS = ['dashboard', 'calls', 'commercial', 'agenda', 'contacts', 'parc', 'tickets', 'tools']

describe('module.colors.js', () => {
  it('définit une palette pour chacun des 8 modules', () => {
    expect(Object.keys(moduleColors).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('chaque palette contient les teintes utilisées par le thème (50, 400, 600, 700)', () => {
    for (const [key, palette] of Object.entries(moduleColors)) {
      for (const shade of ['50', '400', '600', '700']) {
        expect(palette[shade], `teinte ${shade} manquante pour ${key}`).toBeTruthy()
      }
    }
  })
})

describe('moduleTheme', () => {
  it('couvre exactement les mêmes clés que module.colors.js', () => {
    expect(Object.keys(moduleTheme).sort()).toEqual(Object.keys(moduleColors).sort())
  })

  it('utilise uniquement des classes sémantiques module-<clé>', () => {
    for (const [key, theme] of Object.entries(moduleTheme)) {
      expect(theme.icon).toBe(`text-module-${key}-600`)
      expect(theme.bg).toBe(`bg-module-${key}-50`)
      expect(theme.activeBg).toBe(`bg-module-${key}-50`)
      expect(theme.activeText).toBe(`text-module-${key}-700`)
    }
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd client && npx vitest run src/lib/moduleTheme.test.ts`
Expected: FAIL (`Cannot find module '../../module.colors.js'`)

- [ ] **Step 3: Créer `client/module.colors.js`**

```js
import colors from 'tailwindcss/colors'

/**
 * ── CONFIGURATION DES COULEURS PAR MODULE ─────────────────────────────
 * Source de vérité unique du code couleur de l'application.
 * Pour changer la couleur d'un module : remplacer la palette ici
 * (ex: colors.emerald → colors.teal), puis relancer le build/dev.
 * Palettes disponibles : https://tailwindcss.com/docs/customizing-colors
 */
export const moduleColors = {
  dashboard:  colors.indigo,   // Tableau de bord, Rapports
  calls:      colors.sky,      // Appels téléphoniques
  commercial: colors.emerald,  // Pipeline, Leads, Objectifs & Prévisions
  agenda:     colors.violet,   // Agenda & Interventions
  contacts:   colors.blue,     // Contacts, Entreprises, Cartographie
  parc:       colors.cyan,     // Parc clients, Équipements, Licences, Contrats
  tickets:    colors.amber,    // Tickets SAV
  tools:      colors.fuchsia,  // Catalogue, Base de connaissance, Automatisations, NPS, Utilisateurs, Rôles
}
```

- [ ] **Step 4: Créer `client/module.colors.d.ts`**

```ts
export declare const moduleColors: Record<string, Record<string, string>>
```

- [ ] **Step 5: Brancher Tailwind — modifier `client/tailwind.config.js`**

Remplacer le fichier entier par :

```js
/** @type {import('tailwindcss').Config} */
import { moduleColors } from './module.colors.js'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // Palettes sémantiques par module — valeurs définies dans module.colors.js
        ...Object.fromEntries(
          Object.entries(moduleColors).map(([key, palette]) => [`module-${key}`, palette])
        ),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 6: Créer `client/src/lib/moduleTheme.ts`**

```ts
/**
 * Classes Tailwind par module métier. Classes écrites en littéral
 * (jamais construites dynamiquement) pour rester détectables par le purge.
 * Les couleurs réelles sont définies dans client/module.colors.js.
 */
export type ModuleKey =
  | 'dashboard'
  | 'calls'
  | 'commercial'
  | 'agenda'
  | 'contacts'
  | 'parc'
  | 'tickets'
  | 'tools'

export interface ModuleTheme {
  /** Trait d'icône seul (sidebar) — teinte 600 */
  icon: string
  /** Fond de pastille — teinte 50 */
  bg: string
  /** Fond d'état actif (sidebar) — teinte 50 */
  activeBg: string
  /** Texte d'état actif (sidebar) — teinte 700 */
  activeText: string
}

export const moduleTheme: Record<ModuleKey, ModuleTheme> = {
  dashboard: {
    icon: 'text-module-dashboard-600',
    bg: 'bg-module-dashboard-50',
    activeBg: 'bg-module-dashboard-50',
    activeText: 'text-module-dashboard-700',
  },
  calls: {
    icon: 'text-module-calls-600',
    bg: 'bg-module-calls-50',
    activeBg: 'bg-module-calls-50',
    activeText: 'text-module-calls-700',
  },
  commercial: {
    icon: 'text-module-commercial-600',
    bg: 'bg-module-commercial-50',
    activeBg: 'bg-module-commercial-50',
    activeText: 'text-module-commercial-700',
  },
  agenda: {
    icon: 'text-module-agenda-600',
    bg: 'bg-module-agenda-50',
    activeBg: 'bg-module-agenda-50',
    activeText: 'text-module-agenda-700',
  },
  contacts: {
    icon: 'text-module-contacts-600',
    bg: 'bg-module-contacts-50',
    activeBg: 'bg-module-contacts-50',
    activeText: 'text-module-contacts-700',
  },
  parc: {
    icon: 'text-module-parc-600',
    bg: 'bg-module-parc-50',
    activeBg: 'bg-module-parc-50',
    activeText: 'text-module-parc-700',
  },
  tickets: {
    icon: 'text-module-tickets-600',
    bg: 'bg-module-tickets-50',
    activeBg: 'bg-module-tickets-50',
    activeText: 'text-module-tickets-700',
  },
  tools: {
    icon: 'text-module-tools-600',
    bg: 'bg-module-tools-50',
    activeBg: 'bg-module-tools-50',
    activeText: 'text-module-tools-700',
  },
}
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `cd client && npx vitest run src/lib/moduleTheme.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: Vérifier que le build passe**

Run: `cd client && npm run build`
Expected: succès (tsc + vite, aucune erreur)

- [ ] **Step 9: Commit**

```bash
git add client/module.colors.js client/module.colors.d.ts client/tailwind.config.js client/src/lib/moduleTheme.ts client/src/lib/moduleTheme.test.ts
git commit -m "feat(ui): système de couleurs par module (config centralisée module.colors.js)"
```

---

### Task 2: Composant PageIcon

**Files:**
- Create: `client/src/components/ui/PageIcon.tsx`
- Test: `client/src/components/ui/PageIcon.test.tsx`

**Interfaces:**
- Consumes: `moduleTheme`, `ModuleKey` depuis `../../lib/moduleTheme` (Task 1).
- Produces: `PageIcon({ module, icon }: { module: ModuleKey; icon: React.ReactNode })` — export nommé. Carré arrondi 40 px, fond teinte 50, icône teinte 600.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `client/src/components/ui/PageIcon.test.tsx` :

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Wrench } from 'lucide-react'
import { PageIcon } from './PageIcon'

describe('PageIcon', () => {
  it('rend l’icône dans une pastille teintée du module', () => {
    render(<PageIcon module="tickets" icon={<Wrench data-testid="icon" className="w-5 h-5" />} />)
    const icon = screen.getByTestId('icon')
    const wrapper = icon.parentElement!
    expect(wrapper.className).toContain('bg-module-tickets-50')
    expect(wrapper.className).toContain('text-module-tickets-600')
    expect(wrapper.className).toContain('rounded-xl')
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd client && npx vitest run src/components/ui/PageIcon.test.tsx`
Expected: FAIL (`Cannot find module './PageIcon'`)

- [ ] **Step 3: Créer `client/src/components/ui/PageIcon.tsx`**

```tsx
import { moduleTheme, type ModuleKey } from '../../lib/moduleTheme'

interface PageIconProps {
  module: ModuleKey
  icon: React.ReactNode
}

/** Pastille d'en-tête de page : carré arrondi teinté à la couleur du module. */
export function PageIcon({ module, icon }: PageIconProps) {
  const theme = moduleTheme[module]
  return (
    <div className={`w-10 h-10 rounded-xl ${theme.bg} ${theme.icon} flex items-center justify-center flex-shrink-0`}>
      {icon}
    </div>
  )
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `cd client && npx vitest run src/components/ui/PageIcon.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/PageIcon.tsx client/src/components/ui/PageIcon.test.tsx
git commit -m "feat(ui): composant PageIcon (pastille d'en-tête colorée par module)"
```

---

### Task 3: Sidebar — icônes et états actifs colorés par module

**Files:**
- Modify: `client/src/components/layout/Sidebar.tsx`
- Test: `client/src/components/layout/Sidebar.test.tsx` (create)

**Interfaces:**
- Consumes: `moduleTheme`, `ModuleKey` (Task 1).
- Produces: rien de consommé ailleurs (rendu uniquement).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `client/src/components/layout/Sidebar.test.tsx`. Le pattern authStore vient de `client/src/components/CanDo.test.tsx` ; `MemoryRouter` est nécessaire car Sidebar utilise `NavLink`/`useLocation`.

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuthStore } from '../../store/authStore'

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: '1',
      email: 'admin@test.com',
      firstName: 'Admin',
      lastName: 'Test',
      role: 'ADMIN',
      isActive: true,
      permissions: [],
    },
    isAuthenticated: true,
  })
  localStorage.clear()
})

function renderSidebar(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar isOpen onClose={() => {}} />
    </MemoryRouter>
  )
}

describe('Sidebar — couleurs par module', () => {
  it('colore chaque icône de navigation avec la teinte de son module', () => {
    const { container } = renderSidebar()
    for (const cls of [
      'text-module-dashboard-600',
      'text-module-calls-600',
      'text-module-commercial-600',
      'text-module-agenda-600',
      'text-module-contacts-600',
      'text-module-parc-600',
      'text-module-tickets-600',
      'text-module-tools-600',
    ]) {
      expect(container.querySelector(`.${cls}`), `${cls} absent`).not.toBeNull()
    }
  })

  it('applique la teinte du module sur l’item actif', () => {
    const { container } = renderSidebar('/tickets')
    const active = container.querySelector('.bg-module-tickets-50')
    expect(active).not.toBeNull()
    expect(active!.className).toContain('text-module-tickets-700')
  })

  it('laisse Notifications et Paramètres neutres (pas de classe module)', () => {
    const { getByText } = renderSidebar()
    const notif = getByText('Notifications').closest('a')!
    expect(notif.innerHTML).not.toContain('text-module-')
  })
})
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd client && npx vitest run src/components/layout/Sidebar.test.tsx`
Expected: FAIL sur les 2 premiers tests (aucune classe `module-*` dans le rendu actuel)

- [ ] **Step 3: Modifier `client/src/components/layout/Sidebar.tsx`**

3a. Ajouter l'import (après la ligne `import { cn } from '../../lib/utils'`) :

```ts
import { moduleTheme, type ModuleKey } from '../../lib/moduleTheme'
```

3b. Étendre `NavItem` avec un champ `module` optionnel (les items du bas n'en ont pas) :

```ts
interface NavItem {
  label: string
  icon: React.ReactNode
  module?: ModuleKey
  to?: string
  children?: { label: string; to: string; roles?: string[]; permission?: string }[]
  roles?: string[]
}
```

3c. Attribuer les modules dans `navItems` (seule la propriété `module` est ajoutée, le reste ne change pas) :

| Item | module |
|---|---|
| Dashboard | `'dashboard'` |
| Appels | `'calls'` |
| Commercial | `'commercial'` |
| Agenda | `'agenda'` |
| Contacts | `'contacts'` |
| Parc informatique | `'parc'` |
| Tickets SAV | `'tickets'` |
| Outils | `'tools'` |

Exemple pour les deux premiers (répéter le motif pour les 8) :

```ts
const navItems: NavItem[] = [
  { label: 'Dashboard', module: 'dashboard', icon: <LayoutDashboard className="w-4 h-4" />, children: [
    { label: 'Tableau de bord', to: '/' },
    { label: 'Rapports',       to: '/reports' },
  ]},
  { label: 'Appels', module: 'calls', icon: <Phone className="w-4 h-4" />, to: '/calls' },
  // ... idem pour Commercial, Agenda, Contacts, Parc informatique, Tickets SAV, Outils
]
```

`bottomItems` (Notifications, Paramètres) : inchangés, pas de `module`.

3d. Dans le corps du composant, ajouter un helper juste après `isActive` :

```ts
const theme = (item: NavItem) => (item.module ? moduleTheme[item.module] : undefined)
```

3e. Rendu d'un item direct (branche `if (item.to)`) — remplacer le contenu du `NavLink` et sa `className` :

```tsx
return (
  <NavLink
    key={item.to}
    to={item.to}
    onClick={handleNavClick}
    className={({ isActive: active }) => {
      const on = active || (item.to !== '/' && isActive(item.to))
      const t = theme(item)
      return cn('sidebar-item', on && (t ? cn(t.activeBg, t.activeText) : 'active'))
    }}
    end={item.to === '/'}
  >
    <span className={cn('flex items-center', theme(item)?.icon)}>{item.icon}</span>
    <span>{item.label}</span>
  </NavLink>
)
```

3f. Rendu d'un groupe (branche `if (item.children)`) — le bouton :

```tsx
<button
  onClick={() => toggle(item.label)}
  className={cn('sidebar-item w-full', hasActiveChild && (theme(item)?.activeText ?? 'text-primary-700'))}
>
  <span className={cn('flex items-center', theme(item)?.icon)}>{item.icon}</span>
  <span className="flex-1 text-left">{item.label}</span>
  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
</button>
```

3g. Les sous-items actifs prennent la teinte du module — remplacer la `className` du `NavLink` enfant :

```tsx
className={({ isActive: active }) => {
  const t = theme(item)
  return cn('flex items-center py-1.5 px-2 rounded-md text-xs font-medium transition-colors',
    active
      ? t ? cn(t.activeText, t.activeBg) : 'text-primary-700 bg-primary-50'
      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50')
}}
```

3h. `bottomItems` : rendu inchangé (`cn('sidebar-item', active ? 'active' : '')`).

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd client && npx vitest run src/components/layout/Sidebar.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Build + suite complète**

Run: `cd client && npm run build && npm run test`
Expected: build OK, tous les tests verts

- [ ] **Step 6: Commit**

```bash
git add client/src/components/layout/Sidebar.tsx client/src/components/layout/Sidebar.test.tsx
git commit -m "feat(ui): icônes et états actifs de la sidebar colorés par module"
```

---

### Task 4: Dashboard — KpiCard et liste « Ma journée »

**Files:**
- Modify: `client/src/pages/dashboard/DashboardPage.tsx`

**Interfaces:**
- Consumes: `moduleTheme`, `ModuleKey` (Task 1).
- Produces: `KpiCard` gagne une prop obligatoire `module: ModuleKey` (composant interne au fichier, non exporté).

- [ ] **Step 1: Ajouter l'import**

Dans `DashboardPage.tsx`, après `import type { DashboardStats } from '../../types'` :

```ts
import { moduleTheme, type ModuleKey } from '../../lib/moduleTheme'
```

- [ ] **Step 2: Modifier `KpiCard` (lignes ~12-21)**

```tsx
function KpiCard({ icon, label, value, sub, trend, module }: {
  icon: React.ReactNode; label: string; value: string; sub?: string
  trend?: { value: number; label: string }; module: ModuleKey
}) {
  const trendSign = trend ? (trend.value > 0 ? 'positive' : trend.value < 0 ? 'negative' : 'neutral') : null
  const theme = moduleTheme[module]
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl ${theme.bg} ${theme.icon} flex items-center justify-center`}>
          {icon}
        </div>
```

(le reste de `KpiCard` est inchangé)

- [ ] **Step 3: Attribuer un module à chaque appel de `KpiCard`**

Neuf appels (lignes ~522-564). Ajouter la prop `module` à chacun :

| KPI (label) | module |
|---|---|
| CA ce mois | `"commercial"` |
| Pipeline commercial | `"commercial"` |
| Pipeline pondéré | `"commercial"` |
| MRR | `"parc"` |
| Tickets ouverts | `"tickets"` |
| Contacts | `"contacts"` |
| Entreprises | `"contacts"` |
| Contrats actifs | `"parc"` |
| Tickets ce mois | `"tickets"` |

Exemple (premier appel) :

```tsx
<KpiCard
  module="commercial"
  icon={<Euro className="w-5 h-5" />}
  label="CA ce mois"
  value={formatCurrency(stats.opportunities.wonValueThisMonth)}
  sub="Opportunités gagnées"
  trend={{ value: wonVariation, label: 'vs mois dernier' }}
/>
```

- [ ] **Step 4: Aligner les pastilles de « Ma journée »**

4a. RDV du jour (lignes ~189-190) — passer du bleu générique au module agenda :

Avant :
```tsx
<div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
  <CalendarDays className="w-4 h-4 text-blue-500" />
</div>
```
Après :
```tsx
<div className="w-8 h-8 rounded-lg bg-module-agenda-50 flex items-center justify-center flex-shrink-0">
  <CalendarDays className="w-4 h-4 text-module-agenda-600" />
</div>
```

4b. Tickets urgents (lignes ~219-221) — classes sémantiques du module tickets :

Avant :
```tsx
<div className="w-1 self-stretch rounded-full flex-shrink-0 bg-amber-400" />
<div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
  <Wrench className="w-4 h-4 text-amber-500" />
</div>
```
Après :
```tsx
<div className="w-1 self-stretch rounded-full flex-shrink-0 bg-module-tickets-400" />
<div className="w-8 h-8 rounded-lg bg-module-tickets-50 flex items-center justify-center flex-shrink-0">
  <Wrench className="w-4 h-4 text-module-tickets-600" />
</div>
```

4c. Activités à faire (lignes ~241-243) : **inchangé** — le rouge « en retard » est sémantique et reste prioritaire.

- [ ] **Step 5: Build + tests**

Run: `cd client && npm run build && npm run test`
Expected: build OK (tsc signale une erreur si un appel `KpiCard` a été oublié — la prop `module` est obligatoire), tests verts

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/dashboard/DashboardPage.tsx
git commit -m "feat(dashboard): pastilles KPI et liste Ma journée colorées par module"
```

---

### Task 5: En-têtes de pages — Commercial, Appels, Agenda

**Files:**
- Modify: `client/src/pages/calls/CallsPage.tsx:85-89`
- Modify: `client/src/pages/pipeline/PipelinePage.tsx:1110-1113`
- Modify: `client/src/pages/pipeline/LeadsPage.tsx:375-379`
- Modify: `client/src/pages/targets/TargetsPage.tsx:722-725`
- Modify: `client/src/pages/appointments/AppointmentsPage.tsx:540-545`

**Interfaces:**
- Consumes: `PageIcon` (Task 2). Import à ajouter dans chaque fichier : `import { PageIcon } from '../../components/ui/PageIcon'`. Icônes lucide : ajouter le nom à l'import `lucide-react` existant du fichier s'il n'y figure pas déjà.
- Produces: rien.

**Motif commun** — envelopper le bloc titre existant :

Avant (motif) :
```tsx
<div>
  <h1 className="page-title">…</h1>
  <p className="page-subtitle">…</p>
</div>
```
Après (motif) :
```tsx
<div className="flex items-center gap-3">
  <PageIcon module="…" icon={<… className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">…</h1>
    <p className="page-subtitle">…</p>
  </div>
</div>
```

- [ ] **Step 1: CallsPage** — module `"calls"`, icône `Phone` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="calls" icon={<Phone className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Appels téléphoniques</h1>
    <p className="page-subtitle">{data?.meta.total ?? 0} appels</p>
  </div>
</div>
```
(Le détail d'appel — h1 ligne ~385 — ne change pas.)

- [ ] **Step 2: PipelinePage** — module `"commercial"`, icône `TrendingUp` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="commercial" icon={<TrendingUp className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Pipeline commercial</h1>
    <p className="page-subtitle">{activeOpps.length} opportunités en cours</p>
  </div>
</div>
```

- [ ] **Step 3: LeadsPage** — module `"commercial"`, icône `UserPlus` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="commercial" icon={<UserPlus className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Leads</h1>
    <p className="page-subtitle">{totalLeads} leads</p>
  </div>
</div>
```

- [ ] **Step 4: TargetsPage** — remplacer la pastille indigo codée en dur (lignes 723-725) par `PageIcon` :

Avant :
```tsx
<div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
  <Target className="w-5 h-5 text-indigo-600" />
</div>
```
Après :
```tsx
<PageIcon module="commercial" icon={<Target className="w-5 h-5" />} />
```

- [ ] **Step 5: AppointmentsPage** — module `"agenda"`, icône `Calendar` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="agenda" icon={<Calendar className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Agenda & Interventions</h1>
    <p className="page-subtitle">
      {calendarTitle} &mdash; {appointments.length} événement{appointments.length !== 1 ? 's' : ''}
    </p>
  </div>
</div>
```

- [ ] **Step 6: Build + tests**

Run: `cd client && npm run build && npm run test`
Expected: build OK, tests verts

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/calls/CallsPage.tsx client/src/pages/pipeline/PipelinePage.tsx client/src/pages/pipeline/LeadsPage.tsx client/src/pages/targets/TargetsPage.tsx client/src/pages/appointments/AppointmentsPage.tsx
git commit -m "feat(ui): en-têtes colorés — appels, pipeline, leads, objectifs, agenda"
```

---

### Task 6: En-têtes de pages — Dashboard, Contacts, Parc

**Files:**
- Modify: `client/src/pages/dashboard/DashboardPage.tsx:478-482`
- Modify: `client/src/pages/contacts/ContactsPage.tsx:167-170`
- Modify: `client/src/pages/companies/CompaniesPage.tsx:118-121`
- Modify: `client/src/pages/parc/ParcOverviewPage.tsx:42-45`
- Modify: `client/src/pages/equipment/EquipmentPage.tsx:244-247`
- Modify: `client/src/pages/licenses/LicensesPage.tsx:183-186`
- Modify: `client/src/pages/contracts/ContractsPage.tsx:169-172`

**Interfaces:**
- Consumes: `PageIcon` (Task 2), même motif d'enveloppe que Task 5, mêmes règles d'imports.
- Produces: rien.

- [ ] **Step 1: DashboardPage** — module `"dashboard"`, icône `LayoutDashboard` :

```tsx
{/* Header */}
<div className="flex items-center gap-3">
  <PageIcon module="dashboard" icon={<LayoutDashboard className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Tableau de bord</h1>
    <p className="page-subtitle">Vue d'ensemble de votre activité</p>
  </div>
</div>
```

- [ ] **Step 2: ContactsPage** — module `"contacts"`, icône `Users` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="contacts" icon={<Users className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Contacts</h1>
    <p className="page-subtitle">{data?.meta.total || 0} contacts</p>
  </div>
</div>
```

- [ ] **Step 3: CompaniesPage** — module `"contacts"`, icône `Building2` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="contacts" icon={<Building2 className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Entreprises</h1>
    <p className="page-subtitle">{data?.meta.total || 0} entreprises</p>
  </div>
</div>
```

- [ ] **Step 4: ParcOverviewPage** — module `"parc"`, icône `Monitor` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="parc" icon={<Monitor className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Parc informatique</h1>
    <p className="page-subtitle">{companies.length} client{companies.length !== 1 ? 's' : ''} · {totalAlerts} alerte{totalAlerts !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 5: EquipmentPage** — module `"parc"`, icône `HardDrive` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="parc" icon={<HardDrive className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Parc informatique</h1>
    <p className="page-subtitle">{data?.meta?.total ?? data?.data?.length ?? 0} équipements</p>
  </div>
</div>
```

- [ ] **Step 6: LicensesPage** — module `"parc"`, icône `Key` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="parc" icon={<Key className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Licences</h1>
    <p className="page-subtitle">{licenses.length} licence{licenses.length !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 7: ContractsPage** — module `"parc"`, icône `FileText` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="parc" icon={<FileText className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Contrats</h1>
    <p className="page-subtitle">{data?.meta.total ?? 0} contrats</p>
  </div>
</div>
```

- [ ] **Step 8: Build + tests**

Run: `cd client && npm run build && npm run test`
Expected: build OK, tests verts

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/dashboard/DashboardPage.tsx client/src/pages/contacts/ContactsPage.tsx client/src/pages/companies/CompaniesPage.tsx client/src/pages/parc/ParcOverviewPage.tsx client/src/pages/equipment/EquipmentPage.tsx client/src/pages/licenses/LicensesPage.tsx client/src/pages/contracts/ContractsPage.tsx
git commit -m "feat(ui): en-têtes colorés — dashboard, contacts, entreprises, parc"
```

---

### Task 7: En-têtes de pages — Tickets, Outils

**Files:**
- Modify: `client/src/pages/tickets/TicketsPage.tsx:225-229`
- Modify: `client/src/pages/products/ProductsPage.tsx:168-172`
- Modify: `client/src/pages/knowledge/KnowledgePage.tsx:333-336`
- Modify: `client/src/pages/automations/AutomationsPage.tsx:521-525`
- Modify: `client/src/pages/nps/NpsPage.tsx:113-117`
- Modify: `client/src/pages/users/UsersPage.tsx:123-127`
- Modify: `client/src/pages/settings/RolesPage.tsx:103-108`

**Interfaces:**
- Consumes: `PageIcon` (Task 2), même motif d'enveloppe que Task 5, mêmes règles d'imports. Attention : pour `RolesPage.tsx` le chemin d'import est `../../components/ui/PageIcon` (même profondeur que les autres).
- Produces: rien.

- [ ] **Step 1: TicketsPage** — module `"tickets"`, icône `Wrench` (liste seulement ; le détail ligne ~557 ne change pas) :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="tickets" icon={<Wrench className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Tickets SAV</h1>
    <p className="page-subtitle">{data?.meta.total || 0} tickets</p>
  </div>
</div>
```

- [ ] **Step 2: ProductsPage** — module `"tools"`, icône `Package` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="tools" icon={<Package className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Catalogue produits</h1>
    <p className="page-subtitle">{total} produit{total !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 3: KnowledgePage** — module `"tools"`, icône `BookOpen`. Structure différente (bloc `mb-3` dans l'aside) :

Avant :
```tsx
<div className="mb-3">
  <h1 className="page-title">Base de connaissance</h1>
  <p className="page-subtitle text-xs">{totalArticles} article{totalArticles !== 1 ? 's' : ''}</p>
</div>
```
Après :
```tsx
<div className="mb-3 flex items-center gap-3">
  <PageIcon module="tools" icon={<BookOpen className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Base de connaissance</h1>
    <p className="page-subtitle text-xs">{totalArticles} article{totalArticles !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 4: AutomationsPage** — module `"tools"`, icône `Zap` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="tools" icon={<Zap className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Automatisations</h1>
    <p className="page-subtitle">{automations.length} règle{automations.length !== 1 ? 's' : ''} · {active} active{active !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 5: NpsPage** — module `"tools"`, icône `Smile` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="tools" icon={<Smile className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">NPS & Satisfaction client</h1>
    <p className="page-subtitle">{total} réponse{total !== 1 ? 's' : ''} collectée{total !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 6: UsersPage** — module `"tools"`, icône `Users` :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="tools" icon={<Users className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Gestion des utilisateurs</h1>
    <p className="page-subtitle">{users?.length || 0} utilisateur{(users?.length || 0) !== 1 ? 's' : ''}</p>
  </div>
</div>
```

- [ ] **Step 7: RolesPage** — module `"tools"`, icône `Shield` (liste des rôles seulement ; l'écran permissions ligne ~277 ne change pas) :

```tsx
<div className="flex items-center gap-3">
  <PageIcon module="tools" icon={<Shield className="w-5 h-5" />} />
  <div>
    <h1 className="page-title">Gestion des rôles</h1>
    <p className="page-subtitle">
      {roles?.length ?? 0} rôle{(roles?.length ?? 0) > 1 ? 's' : ''}
    </p>
  </div>
</div>
```

- [ ] **Step 8: Build + suite complète**

Run: `cd client && npm run build && npm run test`
Expected: build OK, tous les tests verts

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/tickets/TicketsPage.tsx client/src/pages/products/ProductsPage.tsx client/src/pages/knowledge/KnowledgePage.tsx client/src/pages/automations/AutomationsPage.tsx client/src/pages/nps/NpsPage.tsx client/src/pages/users/UsersPage.tsx client/src/pages/settings/RolesPage.tsx
git commit -m "feat(ui): en-têtes colorés — tickets, catalogue, connaissance, automatisations, nps, utilisateurs, rôles"
```

---

### Task 8: Vérification visuelle finale

**Files:** aucun (vérification).

- [ ] **Step 1: Lancer le dev server**

Run: `cd client && npm run dev`

- [ ] **Step 2: Vérifier visuellement** (navigateur ou capture d'écran) :
  - Sidebar : 8 icônes colorées, Notifications/Paramètres neutres, item actif teinté à la couleur de son module.
  - Dashboard : pastilles KPI émeraude/cyan/ambre/bleu, en-tête avec pastille indigo, « Ma journée » alignée.
  - Une page par module (ex. `/tickets`, `/pipeline`, `/licenses`) : pastille d'en-tête à la bonne couleur.
  - Test de la config : changer une palette dans `client/module.colors.js` (ex. `tickets: colors.rose`), vérifier que sidebar + dashboard + en-tête Tickets basculent, puis **remettre `colors.amber`**.

- [ ] **Step 3: Rien à committer** (le changement de test de la config doit être annulé). Vérifier `git status` propre côté `client/`.
