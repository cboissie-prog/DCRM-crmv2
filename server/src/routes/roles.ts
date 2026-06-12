import { Router, Response } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../prisma/client'
import { AuthRequest, requirePermission } from '../middleware/auth'
import { handleRouteError } from '../middleware/errorHandler'
import { audit } from '../lib/audit'

const router = Router()

type RoleWithRelations = Prisma.RoleGetPayload<{
  include: {
    _count: { select: { permissions: true; users: true } }
    permissions: { include: { permission: true } }
  }
}>

// All routes require settings:roles permission (authenticate is applied at app level)

// GET /api/roles — liste tous les rôles avec leur nombre de permissions et d'utilisateurs
router.get('/', requirePermission('settings:roles'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const roles = await prisma.role.findMany({
      include: { _count: { select: { permissions: true, users: true } } },
      orderBy: { name: 'asc' }
    }) as RoleWithRelations[]
    res.json({
      success: true,
      data: roles.map(r => ({
        id: r.id,
        name: r.name,
        label: r.label,
        isSystem: r.isSystem,
        permissionsCount: r._count.permissions,
        usersCount: r._count.users,
      }))
    })
  } catch (err) { handleRouteError(err, res) }
})

// GET /api/roles/permissions/all — liste toutes les permissions disponibles, groupées par catégorie
// IMPORTANT: ce route doit être déclarée AVANT /:id pour éviter la collision
router.get('/permissions/all', requirePermission('settings:roles'), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const permissions = await prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] })

    // Grouper par catégorie
    const grouped = permissions.reduce<Record<string, typeof permissions>>((acc, perm) => {
      if (!acc[perm.category]) acc[perm.category] = []
      acc[perm.category].push(perm)
      return acc
    }, {})

    res.json({ success: true, data: grouped })
  } catch (err) { handleRouteError(err, res) }
})

// GET /api/roles/:id — détail d'un rôle avec toutes ses permissions
router.get('/:id', requirePermission('settings:roles'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params.id as string
  try {
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } }
      }
    }) as RoleWithRelations | null
    if (!role) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Rôle introuvable' } })
      return
    }
    res.json({
      success: true,
      data: {
        id: role.id,
        name: role.name,
        label: role.label,
        isSystem: role.isSystem,
        usersCount: role._count.users,
        permissions: role.permissions.map(rp => rp.permission),
      }
    })
  } catch (err) { handleRouteError(err, res) }
})

// POST /api/roles — crée un nouveau rôle
router.post('/', requirePermission('settings:roles'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({
      name: z.string().min(1),
      label: z.string().min(1),
    }).parse(req.body)
    const normalizedName = body.name.toUpperCase()

    const existing = await prisma.role.findUnique({ where: { name: normalizedName } })
    if (existing) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Un rôle avec ce nom existe déjà' } })
      return
    }

    const role = await prisma.role.create({
      data: { name: normalizedName, label: body.label, isSystem: false }
    })
    audit(req, 'ROLE_CREATED', 'Role', role.id, { name: role.name, label: role.label })
    res.status(201).json({ success: true, data: role })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /api/roles/:id — modifie le label d'un rôle
router.put('/:id', requirePermission('settings:roles'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params.id as string
  try {
    const body = z.object({
      label: z.string().min(1),
    }).parse(req.body)

    const role = await prisma.role.findUnique({ where: { id } })
    if (!role) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Rôle introuvable' } })
      return
    }

    const updated = await prisma.role.update({
      where: { id },
      data: { label: body.label }
    })
    res.json({ success: true, data: updated })
  } catch (err) { handleRouteError(err, res) }
})

// PUT /api/roles/:id/permissions — remplace toutes les permissions d'un rôle
router.put('/:id/permissions', requirePermission('settings:roles'), async (req: AuthRequest, res: Response): Promise<void> => {
  const roleId = req.params.id as string
  try {
    const body = z.object({
      permissionIds: z.array(z.string()),
    }).parse(req.body)

    const role = await prisma.role.findUnique({ where: { id: roleId } })
    if (!role) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Rôle introuvable' } })
      return
    }

    // Valide que tous les permissionIds existent avant toute modification
    if (body.permissionIds.length > 0) {
      const foundPermissions = await prisma.permission.findMany({
        where: { id: { in: body.permissionIds } },
        select: { id: true },
      })
      if (foundPermissions.length !== body.permissionIds.length) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PERMISSION_IDS', message: 'Une ou plusieurs permissions sont introuvables' } })
        return
      }
    }

    // Enveloppe deleteMany + createMany + révocation des tokens dans une transaction atomique
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } })
      if (body.permissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: body.permissionIds.map((permissionId: string) => ({ roleId, permissionId }))
        })
      }
      // Invalide les refresh tokens des users de ce rôle → force re-login avec nouvelles permissions
      await tx.refreshToken.deleteMany({
        where: { user: { roleId } }
      })
    })
    audit(req, 'ROLE_PERMISSIONS_CHANGED', 'Role', roleId, { permissionsCount: body.permissionIds.length })

    const updated = await prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } }
    }) as RoleWithRelations | null

    res.json({
      success: true,
      data: {
        id: updated!.id,
        name: updated!.name,
        label: updated!.label,
        isSystem: updated!.isSystem,
        permissions: updated!.permissions.map(rp => rp.permission),
      }
    })
  } catch (err) { handleRouteError(err, res) }
})

// DELETE /api/roles/:id — supprime un rôle
router.delete('/:id', requirePermission('settings:roles'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params.id as string
  try {
    const role = await prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } }
    }) as RoleWithRelations | null
    if (!role) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Rôle introuvable' } })
      return
    }
    if (role.isSystem) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Impossible de supprimer un rôle système' } })
      return
    }
    if (role._count.users > 0) {
      res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Impossible de supprimer un rôle attribué à des utilisateurs' } })
      return
    }
    await prisma.rolePermission.deleteMany({ where: { roleId: id } })
    await prisma.role.delete({ where: { id } })
    audit(req, 'ROLE_DELETED', 'Role', id, { name: role.name })
    res.json({ success: true, data: { message: 'Rôle supprimé avec succès' } })
  } catch (err) { handleRouteError(err, res) }
})

export default router
