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
  todo:       colors.rose,     // Todolist personnelle
}
