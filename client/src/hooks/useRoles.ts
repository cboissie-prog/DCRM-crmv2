import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Permission {
  id: string
  key: string
  label: string
  category: string
}

export interface RoleSummary {
  id: string
  name: string
  label: string
  isSystem: boolean
  permissionsCount: number
  usersCount: number
}

export interface RoleDetail {
  id: string
  name: string
  label: string
  isSystem: boolean
  usersCount: number
  permissions: Permission[]
}

export type AllPermissions = Record<string, Permission[]>

// ─── Hooks de lecture ─────────────────────────────────────────────────────────

export function useRoles() {
  return useQuery<RoleSummary[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await api.get('/roles')
      return data.data
    },
    staleTime: 30_000,
  })
}

export function useRole(id: string) {
  return useQuery<RoleDetail>({
    queryKey: ['roles', id],
    queryFn: async () => {
      const { data } = await api.get(`/roles/${id}`)
      return data.data
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useAllPermissions() {
  return useQuery<AllPermissions>({
    queryKey: ['permissions'],
    queryFn: async () => {
      const { data } = await api.get('/roles/permissions/all')
      return data.data
    },
    staleTime: 5 * 60_000,
  })
}

// ─── Hooks de mutation ────────────────────────────────────────────────────────

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation<RoleDetail, Error, { name: string; label: string }>({
    mutationFn: async (variables) => {
      const { data } = await api.post('/roles', variables)
      return data.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation<RoleDetail, Error, { id: string; label: string }>({
    mutationFn: async ({ id, label }) => {
      const { data } = await api.put(`/roles/${id}`, { label })
      return data.data
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['roles', id] })
    },
  })
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; permissionIds: string[] }>({
    mutationFn: async ({ id, permissionIds }) => {
      await api.put(`/roles/${id}/permissions`, { permissionIds })
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      qc.invalidateQueries({ queryKey: ['roles', id] })
    },
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await api.delete(`/roles/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
    },
  })
}
