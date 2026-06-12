import { Link } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'

export function AccessDeniedPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] fade-in">
      <div className="card max-w-md w-full text-center p-8 space-y-5">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
            <ShieldOff className="w-8 h-8 text-red-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-slate-900">Accès refusé</h1>
          <p className="text-slate-500 text-sm">
            Vous n'avez pas la permission d'accéder à cette page.
            Contactez un administrateur si vous pensez qu'il s'agit d'une erreur.
          </p>
        </div>
        <Link to="/" className="btn-primary inline-flex justify-center">
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  )
}
