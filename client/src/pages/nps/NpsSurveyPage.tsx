import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import axios from 'axios'
import { PageSpinner, Spinner } from '../../components/ui/Spinner'
import { CheckCircle2, Frown, Meh, Smile } from 'lucide-react'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

/**
 * Page publique d'enquête NPS (sans authentification) : accessible via le lien
 * signé envoyé dans l'email de clôture d'un ticket.
 */
export function NpsSurveyPage() {
  const { token } = useParams<{ token: string }>()
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['nps-survey', token],
    queryFn: async () => {
      const { data } = await axios.get(`${BASE_URL}/nps/${token}`)
      return data.data as { reference: string; title: string; alreadyAnswered: boolean }
    },
    enabled: !!token,
    retry: false,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      await axios.post(`${BASE_URL}/nps/${token}`, { score, comment: comment.trim() || undefined })
    },
    onSuccess: () => setSubmitted(true),
  })

  if (isLoading) return <PageSpinner />

  if (isError || !data) {
    return (
      <CenteredCard>
        <Frown className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Lien invalide ou expiré</h1>
        <p className="text-sm text-slate-500">Ce lien d'enquête n'est plus valide. Merci de contacter votre interlocuteur DCB Technologies.</p>
      </CenteredCard>
    )
  }

  if (submitted || data.alreadyAnswered) {
    return (
      <CenteredCard>
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Merci pour votre retour !</h1>
        <p className="text-sm text-slate-500">
          {submitted ? 'Votre avis a bien été enregistré.' : 'Une réponse a déjà été enregistrée pour ce ticket.'}
        </p>
      </CenteredCard>
    )
  }

  const scoreColor = (n: number) =>
    n <= 6 ? 'bg-red-500' : n <= 8 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <CenteredCard wide>
      <div className="text-center mb-6">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Votre avis compte</h1>
        <p className="text-sm text-slate-500">
          Ticket <span className="font-mono text-slate-600">{data.reference}</span> — {data.title}
        </p>
      </div>

      <p className="text-sm font-medium text-slate-700 mb-3 text-center">
        Recommanderiez-vous nos services à un proche ou un collègue ?
      </p>

      <div className="flex justify-center gap-1.5 flex-wrap mb-2">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => setScore(n)}
            className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
              score === n
                ? `${scoreColor(n)} text-white scale-110 shadow`
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-slate-400 px-1 mb-5 max-w-md mx-auto">
        <span className="flex items-center gap-1"><Frown className="w-3.5 h-3.5" /> Pas du tout</span>
        <span className="flex items-center gap-1"><Meh className="w-3.5 h-3.5" /> Peut-être</span>
        <span className="flex items-center gap-1"><Smile className="w-3.5 h-3.5" /> Certainement</span>
      </div>

      <textarea
        className="input resize-none w-full mb-4"
        rows={3}
        maxLength={1000}
        placeholder="Un commentaire ? (facultatif)"
        value={comment}
        onChange={e => setComment(e.target.value)}
      />

      {mutation.isError && (
        <p className="text-sm text-red-500 text-center mb-3">
          Une erreur est survenue lors de l'envoi. Merci de réessayer.
        </p>
      )}

      <button
        className="btn-primary w-full justify-center"
        disabled={score === null || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? <Spinner className="w-4 h-4" /> : null}
        Envoyer mon avis
      </button>
    </CenteredCard>
  )
}

function CenteredCard({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-8 w-full ${wide ? 'max-w-lg' : 'max-w-md'} text-center sm:text-left`}>
        {children}
      </div>
    </div>
  )
}
