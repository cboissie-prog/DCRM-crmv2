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
