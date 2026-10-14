import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'
import type { TodoUserRef } from '../../types'

/**
 * Utilisateurs actifs (id + nom) via `GET /todos/users`. `GET /users` exige `users:read`,
 * absent des rôles commercial/technicien qui doivent pourtant pouvoir partager une liste.
 */
export function useTodoUsers(enabled = true) {
  return useQuery<TodoUserRef[]>({
    queryKey: ['todo-users'],
    queryFn: async () => {
      const { data } = await api.get('/todos/users')
      return (data?.data ?? []) as TodoUserRef[]
    },
    staleTime: 60_000,
    enabled,
  })
}
