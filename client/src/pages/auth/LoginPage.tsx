import { useState } from 'react'
import { Navigate, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '../../store/authStore'
import { Spinner } from '../../components/ui/Spinner'
import { Monitor, Mail, Lock, AlertCircle } from 'lucide-react'

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api') as string
// URL de base du serveur (sans le préfixe /api) pour les redirections OAuth
const SERVER_BASE = API_BASE.endsWith('/api') ? API_BASE.slice(0, -4) : API_BASE

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_unauthorized: 'Ce compte Google n\'est pas autorisé à accéder à cette application.',
  account_disabled: 'Ce compte est désactivé. Contactez votre administrateur.',
  session: 'La session Google a échoué. Veuillez réessayer.',
}

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
})

type FormData = z.infer<typeof schema>

export function LoginPage() {
  const { login, isAuthenticated } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Tous les hooks avant le early return (Rules of Hooks)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  if (isAuthenticated) return <Navigate to="/" replace />

  // Erreur renvoyée par l'OAuth callback (query param ?error=...)
  const oauthError = searchParams.get('error')
  const oauthErrorMessage = oauthError ? (GOOGLE_ERROR_MESSAGES[oauthError] ?? 'Erreur de connexion Google.') : null

  const onSubmit = async (data: FormData) => {
    setError(null)
    try {
      await login(data.email, data.password)
      navigate('/', { replace: true })
    } catch {
      setError('Email ou mot de passe incorrect')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Monitor className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">MonCRM</h1>
          <p className="text-slate-500 text-sm mt-1">Solutions informatiques</p>
        </div>

        {/* Card */}
        <div className="card">
          <div className="card-body">
            <h2 className="text-lg font-semibold text-slate-900 mb-6">Connexion</h2>

            {(error || oauthErrorMessage) && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error ?? oauthErrorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="form-group">
                <label className="label">Adresse email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    {...register('email')}
                    type="email"
                    className={`input pl-9 ${errors.email ? 'input-error' : ''}`}
                    placeholder="vous@exemple.fr"
                  />
                </div>
                {errors.email && <p className="form-error">{errors.email.message}</p>}
              </div>

              <div className="form-group">
                <label className="label">Mot de passe</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    {...register('password')}
                    type="password"
                    className={`input pl-9 ${errors.password ? 'input-error' : ''}`}
                    placeholder="••••••••"
                  />
                </div>
                {errors.password && <p className="form-error">{errors.password.message}</p>}
              </div>

              <button type="submit" disabled={isSubmitting} className="btn-primary w-full justify-center btn-lg mt-2">
                {isSubmitting ? <Spinner className="w-4 h-4" /> : 'Se connecter'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <Link to="/forgot-password" className="text-sm text-primary-600 hover:text-primary-700">
                Mot de passe oublié ?
              </Link>
            </div>

            {/* Séparateur */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs text-slate-400">
                <span className="bg-white px-3">ou</span>
              </div>
            </div>

            {/* Bouton Google */}
            <button
              type="button"
              onClick={() => { window.location.href = `${SERVER_BASE}/api/auth/google` }}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
            >
              {/* Logo Google SVG multicolore officiel */}
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              Se connecter avec Google
            </button>

          </div>
        </div>
      </div>
    </div>
  )
}
