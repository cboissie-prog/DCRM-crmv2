import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '../../lib/api'
import { Spinner } from '../../components/ui/Spinner'
import { Monitor, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import type { Resolver } from 'react-hook-form'

const schema = z.object({ email: z.string().email('Email invalide') })
type FormData = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
  })

  const onSubmit = async (data: FormData) => {
    setError(null)
    try {
      await api.post('/auth/forgot-password', data)
      setSent(true)
    } catch {
      setError('Une erreur est survenue. Réessayez plus tard.')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Monitor className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">MonCRM</h1>
          <p className="text-slate-500 text-sm mt-1">Mot de passe oublié</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          {sent ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Email envoyé !</h2>
              <p className="text-sm text-slate-500 mb-6">
                Si cet email est associé à un compte, vous recevrez un lien de réinitialisation dans quelques minutes.
              </p>
              <Link to="/login" className="btn btn-primary w-full justify-center">
                Retour à la connexion
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Réinitialiser le mot de passe</h2>
              <p className="text-sm text-slate-500 mb-6">
                Entrez votre email et nous vous enverrons un lien de réinitialisation.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="form-label">Adresse email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      {...register('email')}
                      type="email"
                      placeholder="votre@email.com"
                      className="input pl-9"
                      autoComplete="email"
                    />
                  </div>
                  {errors.email && <p className="form-error">{errors.email.message}</p>}
                </div>

                <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full justify-center">
                  {isSubmitting ? <Spinner size="sm" /> : 'Envoyer le lien'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link to="/login" className="flex items-center justify-center gap-1 text-sm text-primary-600 hover:text-primary-700">
                  <ArrowLeft className="w-4 h-4" /> Retour à la connexion
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
