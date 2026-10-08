import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import type { ProspectList } from '../types'

/**
 * Listes de prospection (module Prospection) — `GET /prospection/lists` ne renvoie que les
 * listes actives par défaut (`?status=ARCHIVED` pour les archivées) : ce hook combine les deux
 * pour les écrans qui ont besoin de résoudre une liste quel que soit son statut
 * (`ProspectListPage` ouverte par URL directe, `ListsTab` avec le filtre Archivées).
 *
 * Clé de requête préfixée `['prospection-lists', …]` — `qc.invalidateQueries({ queryKey:
 * ['prospection-lists'] })` invalide les deux sous-requêtes (correspondance par préfixe).
 */
export function useProspectLists(opts?: { includeArchived?: boolean }) {
  const activeQuery = useQuery<ProspectList[]>({
    queryKey: ['prospection-lists', 'ACTIVE'],
    queryFn: async () => { const { data } = await api.get('/prospection/lists'); return data.data ?? [] },
    staleTime: 15_000,
  })
  const archivedQuery = useQuery<ProspectList[]>({
    queryKey: ['prospection-lists', 'ARCHIVED'],
    queryFn: async () => { const { data } = await api.get('/prospection/lists', { params: { status: 'ARCHIVED' } }); return data.data ?? [] },
    enabled: !!opts?.includeArchived,
    staleTime: 15_000,
  })

  const active = activeQuery.data ?? []
  const archived = archivedQuery.data ?? []

  return {
    active,
    archived,
    all: opts?.includeArchived ? [...active, ...archived] : active,
    isLoading: activeQuery.isLoading || (!!opts?.includeArchived && archivedQuery.isLoading),
  }
}
