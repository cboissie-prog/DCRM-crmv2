import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Filet de sécurité global : capture les erreurs de rendu au lieu de laisser React
 * démonter toute l'application.
 *
 * Sans lui, une seule valeur inattendue renvoyée par l'API — une date invalide traversant
 * `formatDate`, un `.map` sur un champ absent — remplaçait l'écran entier par une page blanche,
 * sans message ni moyen de repartir autrement qu'en rechargeant à la main.
 *
 * React n'expose pas les limites d'erreur aux composants de fonction : ce composant doit
 * rester une classe.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Pas de service de collecte côté client pour l'instant : la console reste le seul
    // endroit où la pile complète est consultable.
    console.error('[ErrorBoundary] Erreur de rendu non rattrapée', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleBackHome = () => {
    // Rechargement complet volontaire : le state React est potentiellement incohérent,
    // une simple navigation client le conserverait.
    window.location.href = '/'
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-slate-50">
        <div className="card max-w-lg w-full text-center p-8 space-y-5">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-slate-900">Une erreur est survenue</h1>
            <p className="text-slate-500 text-sm">
              L'affichage de cette page a échoué. Vos données ne sont pas perdues —
              il s'agit d'un problème d'affichage, pas d'enregistrement.
            </p>
          </div>

          {import.meta.env.DEV && (
            <pre className="text-left text-xs bg-slate-100 border border-slate-200 rounded p-3 overflow-x-auto text-red-700">
              {error.message}
            </pre>
          )}

          <div className="flex gap-3 justify-center">
            <button onClick={this.handleReload} className="btn-primary">
              Recharger la page
            </button>
            <button onClick={this.handleBackHome} className="btn-secondary">
              Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    )
  }
}
