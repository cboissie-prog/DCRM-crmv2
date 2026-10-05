import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

// Pile des modales ouvertes : Échap ne ferme que la plus récente (modales empilées)
const openStack: symbol[] = []

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const id = Symbol('modal')
    openStack.push(id)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => {
      const i = openStack.indexOf(id)
      if (i >= 0) openStack.splice(i, 1)
      document.removeEventListener('keydown', handler)
    }
  }, [open, onClose])

  if (!open) return null

  // Portail vers <body> : une modale ouverte depuis un formulaire (ex. création rapide d'une entité
  // via EntityPicker) ne doit pas imbriquer son <form> dans celui du parent — le HTML l'interdit et
  // le navigateur soumettrait alors le formulaire parent en GET natif (rechargement de page).
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative bg-white rounded-2xl shadow-2xl w-full fade-in', sizes[size])}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button onClick={onClose} className="btn-ghost btn-sm rounded-lg p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {/* Les événements React remontent l'arbre même à travers un portail : un submit dans une modale
            empilée ne doit pas atteindre le formulaire de la modale parente. */}
        <div className="p-6" onSubmit={e => e.stopPropagation()}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
