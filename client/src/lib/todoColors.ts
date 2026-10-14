/**
 * Couleurs de liste Todo. Table de correspondance statique : Tailwind ne génère que les classes
 * présentes en toutes lettres dans le code source, on ne construit donc jamais `bg-${color}-500`.
 */
export interface TodoColorInfo {
  label: string
  /** Barre / pastille pleine */
  bar: string
}

export const TODO_COLORS: Record<string, TodoColorInfo> = {
  violet:  { label: 'Violet',  bar: 'bg-violet-500' },
  blue:    { label: 'Bleu',    bar: 'bg-blue-500' },
  cyan:    { label: 'Cyan',    bar: 'bg-cyan-500' },
  emerald: { label: 'Vert',    bar: 'bg-emerald-500' },
  amber:   { label: 'Ambre',   bar: 'bg-amber-500' },
  orange:  { label: 'Orange',  bar: 'bg-orange-500' },
  rose:    { label: 'Rose',    bar: 'bg-rose-500' },
  slate:   { label: 'Ardoise', bar: 'bg-slate-500' },
}

export const TODO_COLOR_KEYS = Object.keys(TODO_COLORS)

const NEUTRAL_BAR = 'bg-slate-300'

/** Classe de la barre de couleur d'une liste (neutre si `null` ou clé inconnue) */
export function todoColorBar(color?: string | null): string {
  return (color && TODO_COLORS[color]?.bar) || NEUTRAL_BAR
}

/** Libellé d'une liste : la liste personnelle d'un autre utilisateur (visible par un admin) porte le nom de son propriétaire. */
export function todoListLabel(
  list: { name: string; isPersonal: boolean; ownerId: string; owner?: { firstName: string; lastName: string } },
  meId?: string,
): string {
  if (!list.isPersonal || list.ownerId === meId || !list.owner) return list.name
  return `${list.name} · ${list.owner.firstName} ${list.owner.lastName}`.trim()
}
