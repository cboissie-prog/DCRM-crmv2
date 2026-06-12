import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()

const PERMISSIONS = [
  // Dashboard
  { key: 'dashboard:read', label: 'Voir le tableau de bord', category: 'Dashboard' },
  // Utilisateurs
  { key: 'users:read', label: 'Voir les utilisateurs', category: 'Utilisateurs' },
  { key: 'users:create', label: 'Créer un utilisateur', category: 'Utilisateurs' },
  { key: 'users:update', label: 'Modifier un utilisateur', category: 'Utilisateurs' },
  { key: 'users:delete', label: 'Supprimer un utilisateur', category: 'Utilisateurs' },
  // Sociétés
  { key: 'companies:read', label: 'Voir les sociétés', category: 'Sociétés' },
  { key: 'companies:create', label: 'Créer une société', category: 'Sociétés' },
  { key: 'companies:update', label: 'Modifier une société', category: 'Sociétés' },
  { key: 'companies:delete', label: 'Supprimer une société', category: 'Sociétés' },
  { key: 'companies:import', label: 'Importer des sociétés (CSV)', category: 'Sociétés' },
  // Contacts
  { key: 'contacts:read', label: 'Voir les contacts', category: 'Contacts' },
  { key: 'contacts:create', label: 'Créer un contact', category: 'Contacts' },
  { key: 'contacts:update', label: 'Modifier un contact', category: 'Contacts' },
  { key: 'contacts:delete', label: 'Supprimer un contact', category: 'Contacts' },
  // Tickets
  { key: 'tickets:read', label: 'Voir les tickets', category: 'Tickets' },
  { key: 'tickets:create', label: 'Créer un ticket', category: 'Tickets' },
  { key: 'tickets:update', label: 'Modifier un ticket', category: 'Tickets' },
  { key: 'tickets:delete', label: 'Supprimer un ticket', category: 'Tickets' },
  { key: 'tickets:export', label: 'Exporter les tickets (CSV)', category: 'Tickets' },
  // Pipeline / Leads
  { key: 'pipeline:read', label: 'Voir le pipeline', category: 'Pipeline' },
  { key: 'pipeline:create', label: 'Créer un lead', category: 'Pipeline' },
  { key: 'pipeline:update', label: 'Modifier un lead', category: 'Pipeline' },
  { key: 'pipeline:delete', label: 'Supprimer un lead', category: 'Pipeline' },
  // Équipements
  { key: 'equipment:read', label: 'Voir les équipements', category: 'Équipements' },
  { key: 'equipment:create', label: 'Créer un équipement', category: 'Équipements' },
  { key: 'equipment:update', label: 'Modifier un équipement', category: 'Équipements' },
  { key: 'equipment:delete', label: 'Supprimer un équipement', category: 'Équipements' },
  // Contrats
  { key: 'contracts:read', label: 'Voir les contrats', category: 'Contrats' },
  { key: 'contracts:create', label: 'Créer un contrat', category: 'Contrats' },
  { key: 'contracts:update', label: 'Modifier un contrat', category: 'Contrats' },
  { key: 'contracts:delete', label: 'Supprimer un contrat', category: 'Contrats' },
  // Produits
  { key: 'products:read', label: 'Voir les produits', category: 'Produits' },
  { key: 'products:create', label: 'Créer un produit', category: 'Produits' },
  { key: 'products:update', label: 'Modifier un produit', category: 'Produits' },
  { key: 'products:delete', label: 'Supprimer un produit', category: 'Produits' },
  // Interventions
  { key: 'interventions:read', label: 'Voir les interventions', category: 'Interventions' },
  { key: 'interventions:create', label: 'Créer une intervention', category: 'Interventions' },
  { key: 'interventions:update', label: 'Modifier une intervention', category: 'Interventions' },
  { key: 'interventions:delete', label: 'Supprimer une intervention', category: 'Interventions' },
  // Rapports
  { key: 'reports:read', label: 'Voir les rapports et statistiques', category: 'Rapports' },
  // Automatisations
  { key: 'automation:read', label: 'Voir les automatisations', category: 'Automatisations' },
  { key: 'automation:create', label: 'Créer une automatisation', category: 'Automatisations' },
  { key: 'automation:update', label: 'Modifier une automatisation', category: 'Automatisations' },
  { key: 'automation:delete', label: 'Supprimer une automatisation', category: 'Automatisations' },
  // Activités
  { key: 'activities:read', label: 'Voir les activités', category: 'Activités' },
  { key: 'activities:create', label: 'Créer une activité', category: 'Activités' },
  { key: 'activities:update', label: 'Modifier une activité', category: 'Activités' },
  { key: 'activities:delete', label: 'Supprimer une activité', category: 'Activités' },
  // Rendez-vous
  { key: 'appointments:read', label: 'Voir les rendez-vous', category: 'Rendez-vous' },
  { key: 'appointments:create', label: 'Créer un rendez-vous', category: 'Rendez-vous' },
  { key: 'appointments:update', label: 'Modifier un rendez-vous', category: 'Rendez-vous' },
  { key: 'appointments:delete', label: 'Supprimer un rendez-vous', category: 'Rendez-vous' },
  // Base de connaissances
  { key: 'knowledge:read', label: 'Voir la base de connaissances', category: 'Connaissances' },
  { key: 'knowledge:create', label: 'Créer un article', category: 'Connaissances' },
  { key: 'knowledge:update', label: 'Modifier un article', category: 'Connaissances' },
  { key: 'knowledge:delete', label: 'Supprimer un article', category: 'Connaissances' },
  // Paramètres
  { key: 'settings:read', label: 'Voir les paramètres', category: 'Paramètres' },
  { key: 'settings:write', label: 'Modifier les paramètres', category: 'Paramètres' },
  { key: 'settings:roles', label: 'Gérer les rôles et permissions', category: 'Paramètres' },
]

/**
 * Seed de production : permissions + rôles + UN seul admin.
 * Exporté pour être réutilisé par seed-demo.ts.
 */
export async function seedBase() {
  console.log('🌱 Seeding base (permissions + rôles + admin)...')

  // ─── PERMISSIONS ───────────────────────────────────────
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { label: perm.label, category: perm.category },
      create: perm,
    })
  }
  console.log('✅ Permissions créées')

  // ─── RÔLES ─────────────────────────────────────────────
  const allKeys = PERMISSIONS.map(p => p.key)
  const managerKeys = allKeys.filter(k => k !== 'users:delete' && k !== 'settings:roles')
  const commercialKeys = [
    'dashboard:read',
    'companies:read', 'companies:create', 'companies:update', 'companies:delete', 'companies:import',
    'contacts:read', 'contacts:create', 'contacts:update', 'contacts:delete',
    'pipeline:read', 'pipeline:create', 'pipeline:update', 'pipeline:delete',
    'tickets:read', 'tickets:create', 'tickets:update',
    'products:read',
    'reports:read',
    'activities:read', 'activities:create', 'activities:update', 'activities:delete',
    'appointments:read', 'appointments:create', 'appointments:update', 'appointments:delete',
  ]
  const technicienKeys = [
    'dashboard:read',
    'companies:read',
    'contacts:read',
    'tickets:read', 'tickets:create', 'tickets:update',
    'equipment:read', 'equipment:create', 'equipment:update', 'equipment:delete',
    'interventions:read', 'interventions:create', 'interventions:update', 'interventions:delete',
    'contracts:read',
    'activities:read', 'activities:create', 'activities:update', 'activities:delete',
    'appointments:read', 'appointments:create', 'appointments:update', 'appointments:delete',
    'knowledge:read',
  ]

  const rolesConfig = [
    { name: 'ADMIN', label: 'Administrateur', isSystem: true, permKeys: allKeys },
    { name: 'MANAGER', label: 'Manager', isSystem: true, permKeys: managerKeys },
    { name: 'COMMERCIAL', label: 'Commercial', isSystem: true, permKeys: commercialKeys },
    { name: 'TECHNICIEN', label: 'Technicien', isSystem: true, permKeys: technicienKeys },
  ]

  // Map nom de rôle → id (utilisé pour lier les users)
  const roleIdByName: Record<string, string> = {}

  for (const rc of rolesConfig) {
    const role = await prisma.role.upsert({
      where: { name: rc.name },
      update: { label: rc.label, isSystem: rc.isSystem },
      create: { name: rc.name, label: rc.label, isSystem: rc.isSystem },
    })
    roleIdByName[rc.name] = role.id

    // Récupérer les permissions concernées
    const permissions = await prisma.permission.findMany({
      where: { key: { in: rc.permKeys } },
    })

    // Upsert des RolePermission (on supprime puis recrée pour rester idempotent)
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
    await prisma.rolePermission.createMany({
      data: permissions.map(p => ({ roleId: role.id, permissionId: p.id })),
    })
  }
  console.log('✅ Rôles créés avec leurs permissions')

  // ─── ADMIN UNIQUE ──────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@crm.local'
  const adminRoleId = roleIdByName['ADMIN']

  // Mot de passe : variable d'env ou génération aléatoire (affiché une seule fois)
  let adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? null
  let generatedPassword: string | null = null
  if (!adminPassword) {
    generatedPassword = randomBytes(12).toString('base64').slice(0, 16)
    adminPassword = generatedPassword
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (!existingAdmin) {
    const adminPwd = await bcrypt.hash(adminPassword, 12)
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: adminPwd,
        firstName: 'Admin',
        lastName: 'CRM',
        phone: '06 12 34 56 78',
        role: 'ADMIN',
        roleId: adminRoleId,
      },
    })
    if (generatedPassword) {
      console.log('\n⚠️  ============================================================')
      console.log('⚠️  MOT DE PASSE ADMIN GÉNÉRÉ (à conserver, affiché UNE SEULE FOIS) :')
      console.log(`⚠️  Email    : ${adminEmail}`)
      console.log(`⚠️  Password : ${generatedPassword}`)
      console.log('⚠️  ============================================================\n')
    } else {
      console.log(`✅ Admin créé : ${adminEmail}`)
    }
  } else {
    // Ne jamais écraser le mot de passe d'un admin existant — mettre à jour roleId seulement si absent
    if (!existingAdmin.roleId) {
      await prisma.user.update({
        where: { email: adminEmail },
        data: { roleId: adminRoleId },
      })
      console.log(`✅ roleId mis à jour pour l'admin existant : ${adminEmail}`)
    } else {
      console.log(`✅ Admin déjà existant (mot de passe inchangé) : ${adminEmail}`)
    }
  }

  // ─── RATTRAPAGE roleId pour toute base existante ───────
  for (const [roleName, roleId] of Object.entries(roleIdByName)) {
    const updated = await prisma.user.updateMany({
      where: { role: roleName, roleId: null },
      data: { roleId },
    })
    if (updated.count > 0) {
      console.log(`✅ Rattrapage roleId : ${updated.count} user(s) mis à jour pour le rôle ${roleName}`)
    }
  }

  console.log('\n✅ Seed de base terminé avec succès !')
  return roleIdByName
}

async function main() {
  await seedBase()
}

// N'exécuter main() que si ce fichier est le point d'entrée (pas lors d'un import)
const isEntryPoint = process.argv[1] && (
  process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js')
)
if (isEntryPoint) {
  main().catch(console.error).finally(() => prisma.$disconnect())
}
