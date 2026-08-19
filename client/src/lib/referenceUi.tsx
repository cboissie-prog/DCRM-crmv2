import type { ComponentType } from 'react'
import {
  Monitor, Laptop, Server, Printer, ShoppingCart, Network, Router, HardDrive,
  Tablet, Smartphone, HelpCircle, ClipboardList, CheckCircle2, Code2, Wifi,
  FileText, Package, Key, Globe, Wrench, GraduationCap, Phone, Mail, Truck,
  Store, Box, Cpu, Camera, Tag, Calculator, Cloud, Database, Shield, Headphones,
} from 'lucide-react'

/**
 * Rendu des référentiels personnalisables (couleurs + icônes).
 *
 * Les valeurs de ReferenceValue portent un jeton couleur (`blue`, `emerald`, …)
 * et un nom d'icône lucide (`Monitor`, …). Ce registre traduit ces jetons en
 * classes Tailwind écrites en toutes lettres (obligatoire : le JIT Tailwind ne
 * génère que les classes présentes littéralement dans le code).
 */

export interface ColorStyle {
  /** Classe badge historique (index.css) — pour les Badge variant=… */
  badge: string
  /** Fond léger + texte + bordure — cartes/catégories (base de connaissances). */
  bg: string
  text: string
  border: string
  /** Barre/pastille pleine. */
  bar: string
  dot: string
  /** Fond clair 100 — évènements agenda. */
  bg100: string
  text700: string
  /** Couleur hex — carte Leaflet. */
  hex: string
}

// eslint-disable-next-line react-refresh/only-export-components
export const COLOR_STYLES: Record<string, ColorStyle> = {
  gray:    { badge: 'badge-gray',   bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200',   bar: 'bg-slate-400',   dot: 'bg-slate-400',   bg100: 'bg-slate-100',   text700: 'text-slate-700',   hex: '#94a3b8' },
  slate:   { badge: 'badge-gray',   bg: 'bg-slate-50',   text: 'text-slate-600',   border: 'border-slate-200',   bar: 'bg-slate-400',   dot: 'bg-slate-400',   bg100: 'bg-slate-100',   text700: 'text-slate-700',   hex: '#64748b' },
  blue:    { badge: 'badge-blue',   bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    bar: 'bg-blue-500',    dot: 'bg-blue-500',    bg100: 'bg-blue-100',    text700: 'text-blue-700',    hex: '#3b82f6' },
  indigo:  { badge: 'badge-indigo', bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  bar: 'bg-indigo-500',  dot: 'bg-indigo-500',  bg100: 'bg-indigo-100',  text700: 'text-indigo-700',  hex: '#6366f1' },
  violet:  { badge: 'badge-purple', bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  bar: 'bg-violet-500',  dot: 'bg-violet-500',  bg100: 'bg-violet-100',  text700: 'text-violet-700',  hex: '#8b5cf6' },
  purple:  { badge: 'badge-purple', bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200',  bar: 'bg-purple-500',  dot: 'bg-purple-500',  bg100: 'bg-purple-100',  text700: 'text-purple-700',  hex: '#a855f7' },
  pink:    { badge: 'badge-purple', bg: 'bg-pink-50',    text: 'text-pink-700',    border: 'border-pink-200',    bar: 'bg-pink-500',    dot: 'bg-pink-500',    bg100: 'bg-pink-100',    text700: 'text-pink-700',    hex: '#ec4899' },
  red:     { badge: 'badge-red',    bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     bar: 'bg-red-500',     dot: 'bg-red-500',     bg100: 'bg-red-100',     text700: 'text-red-700',     hex: '#ef4444' },
  orange:  { badge: 'badge-orange', bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200',  bar: 'bg-orange-500',  dot: 'bg-orange-500',  bg100: 'bg-orange-100',  text700: 'text-orange-700',  hex: '#f97316' },
  amber:   { badge: 'badge-yellow', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   bar: 'bg-amber-500',   dot: 'bg-amber-500',   bg100: 'bg-amber-100',   text700: 'text-amber-700',   hex: '#f59e0b' },
  yellow:  { badge: 'badge-yellow', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   bar: 'bg-amber-500',   dot: 'bg-amber-500',   bg100: 'bg-amber-100',   text700: 'text-amber-700',   hex: '#eab308' },
  green:   { badge: 'badge-green',  bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200',   bar: 'bg-green-500',   dot: 'bg-green-500',   bg100: 'bg-green-100',   text700: 'text-green-700',   hex: '#22c55e' },
  emerald: { badge: 'badge-green',  bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500', bg100: 'bg-emerald-100', text700: 'text-emerald-700', hex: '#10b981' },
  cyan:    { badge: 'badge-cyan',   bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200',    bar: 'bg-cyan-500',    dot: 'bg-cyan-500',    bg100: 'bg-cyan-100',    text700: 'text-cyan-700',    hex: '#06b6d4' },
}

// eslint-disable-next-line react-refresh/only-export-components
export const COLOR_TOKENS = Object.keys(COLOR_STYLES)

const FALLBACK_COLOR: ColorStyle = COLOR_STYLES.gray

/** Style complet d'un jeton couleur (fallback gris pour jeton inconnu/null). */
// eslint-disable-next-line react-refresh/only-export-components
export function colorStyle(token: string | null | undefined): ColorStyle {
  return (token && COLOR_STYLES[token]) || FALLBACK_COLOR
}

/** Classe badge historique d'un jeton (`badge-blue`, …) — fallback `badge-gray`. */
// eslint-disable-next-line react-refresh/only-export-components
export function badgeClass(token: string | null | undefined): string {
  return colorStyle(token).badge
}

// ─── Icônes ──────────────────────────────────────────────────────────────────

type IconComponent = ComponentType<{ className?: string }>

/** Icônes proposées dans Réglages > Listes (et rendues partout ailleurs). */
// eslint-disable-next-line react-refresh/only-export-components
export const REFERENCE_ICONS: Record<string, IconComponent> = {
  Monitor, Laptop, Server, Printer, ShoppingCart, Network, Router, HardDrive,
  Tablet, Smartphone, HelpCircle, ClipboardList, CheckCircle2, Code2, Wifi,
  FileText, Package, Key, Globe, Wrench, GraduationCap, Phone, Mail, Truck,
  Store, Box, Cpu, Camera, Tag, Calculator, Cloud, Database, Shield, Headphones,
}

/** Icône d'une valeur de référentiel — fallback Tag si nom inconnu/absent. */
export function ReferenceIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && REFERENCE_ICONS[name]) || Tag
  return <Icon className={className} />
}
