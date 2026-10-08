/**
 * prospectImport.ts — logique d'import CSV de prospects (entreprise + contact +
 * opportunité), factorisée depuis `POST /pipeline/opportunities/import/csv` pour être
 * réutilisée par `POST /prospection/lists/:id/import` (spec §4 :
 * « même corps et mêmes règles [...] mais listId = :id, pipelineId = null »).
 *
 * La résolution du pipeline/étape par défaut, la vérification des références
 * (`lead_source`) et de l'existence de `assignedToId` restent dans les routes
 * appelantes (messages d'erreur contextuels différents) ; cette fonction ne porte
 * que la création des entreprises/contacts/opportunités et la détection de doublon.
 */
import { z } from 'zod'
import prisma from '../prisma/client'
import { ciContains } from '../lib/query'
import { normalizePhone } from '../lib/phone'
import { getWonLostStageKeys } from './pipelineService'

/** Schéma d'une ligne CSV déjà mise en correspondance côté client — partagé par
 * `POST /pipeline/opportunities/import/csv` et `POST /prospection/lists/:id/import`. */
export const importCsvRowSchema = z.object({
  companyName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  website: z.string().optional(),
  siret: z.string().optional(),
})

export interface ImportProspectRow {
  companyName?: string
  firstName?: string
  lastName?: string
  fullName?: string
  phone?: string
  email?: string
  title?: string
  value?: string | number
  notes?: string
  city?: string
  postalCode?: string
  website?: string
  siret?: string
}

export interface ImportProspectOptions {
  /** Liste de prospection cible — `null` pour l'import historique directement dans le pipeline. */
  listId: string | null
  /** `null` pour un import dans une liste (spec §4 : "pipelineId = null"). */
  pipelineId: string | null
  /** Étape de départ — sans effet si `pipelineId` est `null`. */
  stage: string
  source: string
  assignedToId?: string
}

export interface ImportProspectResult {
  created: { companies: number; contacts: number; opportunities: number }
  skipped: number
  errors: { row: number; reason: string }[]
}

export async function importProspectRows(
  rows: ImportProspectRow[],
  opts: ImportProspectOptions
): Promise<ImportProspectResult> {
  const { wonKeys, lostKeys } = await getWonLostStageKeys()

  // Pré-résolution des entreprises déjà existantes (un seul aller-retour DB).
  const uniqueCompanyNames = [...new Set(
    rows.map(r => r.companyName?.trim()).filter((v): v is string => !!v)
  )]
  const candidateCompanies = uniqueCompanyNames.length > 0
    ? await prisma.company.findMany({
        where: { OR: uniqueCompanyNames.map(n => ({ name: ciContains(n) })) },
        select: { id: true, name: true },
      })
    : []
  const companyByName = new Map<string, string>()
  for (const c of candidateCompanies) companyByName.set(c.name.toLowerCase(), c.id)

  const errors: { row: number; reason: string }[] = []
  let skipped = 0
  let createdCompanies = 0
  let createdContacts = 0
  let createdOpportunities = 0

  for (let batchStart = 0; batchStart < rows.length; batchStart += 50) {
    const batch = rows.slice(batchStart, batchStart + 50)
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < batch.length; i++) {
        const rowIndex = batchStart + i
        const row = batch[i]
        try {
          const companyName = row.companyName?.trim()
          let firstName = row.firstName?.trim() || ''
          let lastName = row.lastName?.trim() || ''
          // Colonne « Contact » à nom complet (« Paul Martin ») : premier mot = prénom, le reste = nom
          if (!firstName && !lastName && row.fullName?.trim()) {
            const parts = row.fullName.trim().split(/\s+/)
            firstName = parts[0]
            lastName = parts.slice(1).join(' ')
          }
          // Un prospect peut être un particulier (société en création) : entreprise OU contact suffit.
          if (!companyName && !firstName && !lastName) {
            errors.push({ row: rowIndex, reason: 'Entreprise ou contact manquant' })
            continue
          }

          let companyId: string | undefined
          if (companyName) {
            const cacheKey = companyName.toLowerCase()
            companyId = companyByName.get(cacheKey)
            if (!companyId) {
              const created = await tx.company.create({
                data: {
                  name: companyName,
                  city: row.city?.trim() || undefined,
                  postalCode: row.postalCode?.trim() || undefined,
                  website: row.website?.trim() || undefined,
                  siret: row.siret?.trim() || undefined,
                },
              })
              companyId = created.id
              companyByName.set(cacheKey, companyId)
              createdCompanies++
            }
          }

          // Contact : email, puis nom + prénom (dans l'entreprise, ou parmi les contacts sans entreprise), sinon création.
          let contactId: string | undefined
          const email = row.email?.trim()
          if (email) {
            const existing = await tx.contact.findFirst({ where: { email }, select: { id: true } })
            if (existing) contactId = existing.id
          }
          if (!contactId && (firstName || lastName)) {
            const candidates = await tx.contact.findMany({
              where: { companyId: companyId ?? null },
              select: { id: true, firstName: true, lastName: true },
            })
            const match = candidates.find(c =>
              c.firstName.toLowerCase() === firstName.toLowerCase() &&
              c.lastName.toLowerCase() === lastName.toLowerCase()
            )
            if (match) contactId = match.id
          }

          // Doublon :
          // - import dans une liste : une fiche non écartée (ni "pas intéressé", ni déjà qualifiée)
          //   de la même liste pour la même entreprise (ou le même contact).
          // - import historique (pipeline) : une opportunité non archivée en étape ouverte,
          //   même pipeline, même entreprise (ou le même contact).
          const dupScope = companyId ? { companyId } : contactId ? { contactId } : null
          if (dupScope) {
            const dupWhere = opts.listId
              ? { ...dupScope, listId: opts.listId, prospectStatus: { notIn: ['NOT_INTERESTED', 'QUALIFIED'] } }
              : { ...dupScope, pipelineId: opts.pipelineId, archivedAt: null, stage: { notIn: [...wonKeys, ...lostKeys] } }
            const existingOpen = await tx.opportunity.findFirst({ where: dupWhere, select: { id: true } })
            if (existingOpen) { skipped++; continue }
          }

          if (!contactId && (firstName || lastName)) {
            const phone = row.phone?.trim() || undefined
            const createdContact = await tx.contact.create({
              data: {
                firstName: firstName || '—',
                lastName: lastName || '—',
                email: email || undefined,
                phone,
                phoneNormalized: normalizePhone(phone),
                companyId,
                source: opts.source,
                status: 'PROSPECT',
              },
            })
            contactId = createdContact.id
            createdContacts++
          }

          const rawValue = row.value
          const parsedValue = rawValue === undefined || rawValue === '' ? 0 : Number(rawValue)

          await tx.opportunity.create({
            data: {
              title: row.title?.trim() || companyName || `${firstName} ${lastName}`.trim(),
              companyId,
              contactId,
              listId: opts.listId,
              pipelineId: opts.pipelineId,
              stage: opts.stage,
              value: Number.isFinite(parsedValue) ? parsedValue : 0,
              source: opts.source,
              prospectStatus: 'TODO',
              assignedToId: opts.assignedToId,
              notes: row.notes?.trim() || undefined,
            },
          })
          createdOpportunities++
        } catch (rowErr) {
          errors.push({ row: rowIndex, reason: rowErr instanceof Error ? rowErr.message : 'Erreur inconnue' })
        }
      }
    })
  }

  return {
    created: { companies: createdCompanies, contacts: createdContacts, opportunities: createdOpportunities },
    skipped,
    errors,
  }
}
