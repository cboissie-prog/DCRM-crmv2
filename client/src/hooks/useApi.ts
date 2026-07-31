import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import api from '../lib/api'
import { AxiosError } from 'axios'

// Generic list hook — renvoie directement le tableau data.data (typé T)
export function useList<T>(
  key: string[],
  endpoint: string,
  params?: Record<string, unknown>,
  options?: Partial<UseQueryOptions<T>>
) {
  return useQuery<T>({
    queryKey: [...key, params],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params })
      return data.data as T
    },
    staleTime: 30_000,
    ...options,
  })
}

/**
 * Liste des utilisateurs — hook unique pour la clé de cache partagée `['users-list']`.
 *
 * Six écrans consommaient cette même clé avec des fonctions de requête renvoyant deux formes
 * différentes : les unes l'enveloppe `{ success, data }`, les autres le tableau. Avec un
 * `staleTime` de 60 s, le second écran visité lisait la forme du premier sans refetch, et un
 * `.map` sur l'enveloppe faisait tomber la page entière (passer de l'Agenda au Pipeline suffisait).
 * Une seule fonction de requête pour une seule clé : la forme ne peut plus diverger.
 */
export function useUsersList<T = { id: string; firstName: string; lastName: string }>(
  options?: Partial<UseQueryOptions<T[]>>
) {
  return useQuery<T[]>({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data } = await api.get('/users')
      return (data?.data ?? []) as T[]
    },
    staleTime: 60_000,
    ...options,
  })
}

// Generic list hook with meta — renvoie { data: T; meta?: { total, page, limit } }
export interface ListWithMeta<T> {
  data: T
  meta?: { total: number; page: number; limit: number }
}

export function useListWithMeta<T>(
  key: string[],
  endpoint: string,
  params?: Record<string, unknown>,
  options?: Partial<UseQueryOptions<ListWithMeta<T>>>
) {
  return useQuery<ListWithMeta<T>>({
    queryKey: [...key, params],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params })
      return { data: data.data as T, meta: data.meta }
    },
    staleTime: 30_000,
    ...options,
  })
}

// Generic item hook
export function useItem<T>(key: string[], endpoint: string, id?: string) {
  return useQuery<T>({
    queryKey: [...key, id],
    queryFn: async () => {
      const { data } = await api.get(`${endpoint}/${id}`)
      return data.data
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

// Generic create mutation
export function useCreate<TData, TVariables>(endpoint: string, invalidateKeys: string[][]) {
  const qc = useQueryClient()
  return useMutation<TData, AxiosError, TVariables>({
    mutationFn: async (variables) => {
      const { data } = await api.post(endpoint, variables)
      return data.data
    },
    onSuccess: () => {
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: k }))
    },
  })
}

// Generic update mutation — id passé au moment de la mutation : mutate({ id, data })
export function useUpdate<TData, TVariables>(endpoint: string, invalidateKeys: string[][]) {
  const qc = useQueryClient()
  return useMutation<TData, AxiosError, { id: string; data: TVariables }>({
    mutationFn: async ({ id, data: variables }) => {
      const { data } = await api.put(`${endpoint}/${id}`, variables)
      return data.data
    },
    onSuccess: () => {
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: k }))
    },
  })
}

// Generic delete mutation
export function useDelete(endpoint: string, invalidateKeys: string[][]) {
  const qc = useQueryClient()
  return useMutation<void, AxiosError, string>({
    mutationFn: async (id) => {
      await api.delete(`${endpoint}/${id}`)
    },
    onSuccess: () => {
      invalidateKeys.forEach(k => qc.invalidateQueries({ queryKey: k }))
    },
  })
}
