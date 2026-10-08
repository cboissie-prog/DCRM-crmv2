/**
 * prospectActions.ts — logique des actions rapides de prospection, partagée entre
 * `POST /api/prospection/prospects/:id/actions` et `POST /api/pipeline/opportunities/:id/actions`
 * (spec docs/superpowers/specs/2026-10-08-prospection-module-design.md, §4).
 *
 * Un prospect et une opportunité sont la même fiche `Opportunity` : `applyAction` ne
 * distingue pas les deux contextes, c'est à l'appelant (route) de restreindre les
 * actions disponibles (ex. NOT_INTERESTED/REOPEN exclus depuis le pipeline).
 *
 * Chaque action :
 * - écrit UNE `Activity` (auteur = `userId`) ;
 * - pose `lastActivityAt = now` sur l'opportunité ;
 * - auto-attribue la fiche à l'auteur si elle n'a pas encore de `assignedToId`.
 */
import prisma from '../prisma/client'
import { checkReferences } from '../lib/references'
import { getSettingInt } from '../lib/settings'

export const PROSPECT_ACTIONS = [
  'NO_ANSWER', 'REACHED', 'CALLBACK', 'DOC_SENT', 'EMAIL_SENT', 'MEETING_SET',
  'NOTE', 'NEXT_ACTION', 'QUALIFICATION', 'NOT_INTERESTED', 'REOPEN',
] as const
export type ProspectAction = typeof PROSPECT_ACTIONS[number]

/** Sous-ensemble autorisé depuis le pipeline : on perd une affaire via l'étape Perdu, pas via une action. */
export const PIPELINE_EXCLUDED_ACTIONS = ['NOT_INTERESTED', 'REOPEN'] as const

export interface ApplyActionPayload {
  nextAction?: string | null
  remindAt?: string | null
  note?: string | null
  document?: string
  startAt?: string
  title?: string
  criteria?: Record<string, boolean | null>
  reason?: string
}

export class ProspectActionError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function isValidAction(action: string): action is ProspectAction {
  return (PROSPECT_ACTIONS as readonly string[]).includes(action)
}

export async function applyAction(
  opportunityId: string,
  action: string,
  payload: ApplyActionPayload,
  userId: string
) {
  if (!isValidAction(action)) {
    throw new ProspectActionError('INVALID_ACTION', `Action inconnue : ${action}`)
  }

  const opp = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      id: true, title: true, contactId: true, companyId: true, assignedToId: true,
      callAttempts: true, remindAt: true, documentsSent: true, qualification: true,
      company: { select: { name: true } },
    },
  })
  if (!opp) throw new ProspectActionError('NOT_FOUND', 'Prospect introuvable', 404)

  const data: Record<string, unknown> = {}
  let activityType: string = action
  let activityTitle = ''
  let activityDescription: string | undefined

  switch (action) {
    case 'NO_ANSWER': {
      const maxAttempts = await getSettingInt('prospectMaxAttempts', 3)
      const callbackDays = await getSettingInt('prospectCallbackDays', 2)
      const retryDays = await getSettingInt('prospectUnreachableRetryDays', 30)
      const attempts = opp.callAttempts + 1
      data.callAttempts = attempts
      data.lastContactedAt = new Date()
      if (attempts >= maxAttempts) {
        data.prospectStatus = 'UNREACHABLE'
        data.remindAt = new Date(Date.now() + retryDays * 24 * 60 * 60 * 1000)
        activityType = 'UNREACHABLE'
        activityTitle = `Injoignable après ${attempts} tentatives`
      } else {
        data.prospectStatus = 'NO_ANSWER'
        // Rappel proposé seulement si aucun n'est déjà posé (on ne doit pas écraser un rendez-vous existant).
        if (!opp.remindAt) data.remindAt = new Date(Date.now() + callbackDays * 24 * 60 * 60 * 1000)
        activityType = 'CALL_NO_ANSWER'
        activityTitle = 'Appel sans réponse'
      }
      break
    }

    case 'REACHED': {
      if (!payload.remindAt) throw new ProspectActionError('REMIND_AT_REQUIRED', 'Une date de prochaine action est requise ("et ensuite ?")')
      if (!payload.nextAction) throw new ProspectActionError('NEXT_ACTION_REQUIRED', 'Un libellé de prochaine action est requis ("et ensuite ?")')
      data.callAttempts = opp.callAttempts + 1
      data.lastContactedAt = new Date()
      data.prospectStatus = 'REACHED'
      data.remindAt = new Date(payload.remindAt)
      data.nextAction = payload.nextAction
      activityType = 'CALL_REACHED'
      activityTitle = 'Joint par téléphone'
      activityDescription = payload.note ?? undefined
      break
    }

    case 'CALLBACK': {
      if (!payload.remindAt) throw new ProspectActionError('REMIND_AT_REQUIRED', 'Une date de rappel est requise')
      data.prospectStatus = 'CALLBACK'
      data.remindAt = new Date(payload.remindAt)
      if (payload.nextAction !== undefined) data.nextAction = payload.nextAction
      activityType = 'CALLBACK_SET'
      activityTitle = 'Rappel programmé'
      break
    }

    case 'DOC_SENT': {
      if (!payload.document) throw new ProspectActionError('DOCUMENT_REQUIRED', 'Un document est requis')
      const refError = await checkReferences([{ domain: 'prospect_documents', value: payload.document }])
      if (refError) throw new ProspectActionError('INVALID_REFERENCE', refError)
      const current: string[] = opp.documentsSent ? JSON.parse(opp.documentsSent) : []
      if (!current.includes(payload.document)) current.push(payload.document)
      data.documentsSent = JSON.stringify(current)
      activityType = 'DOC_SENT'
      activityTitle = `Document envoyé : ${payload.document}`
      break
    }

    case 'EMAIL_SENT': {
      activityType = 'EMAIL_SENT'
      activityTitle = 'Email envoyé'
      activityDescription = payload.note ?? undefined
      break
    }

    case 'MEETING_SET': {
      if (!payload.startAt) throw new ProspectActionError('START_AT_REQUIRED', 'La date du rendez-vous est requise')
      const startAt = new Date(payload.startAt)
      if (isNaN(startAt.getTime())) throw new ProspectActionError('VALIDATION_ERROR', 'Date de rendez-vous invalide')
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000) // durée par défaut 1h (non fournie par le mini-formulaire)
      const title = payload.title?.trim() || `RDV — ${opp.title}`
      await prisma.appointment.create({
        data: {
          title,
          type: 'CLIENT_MEETING',
          startAt,
          endAt,
          opportunityId,
          createdById: userId,
          description: opp.company?.name ? `Entreprise : ${opp.company.name}` : undefined,
          users: { create: [{ userId }] },
          ...(opp.contactId ? { contacts: { create: [{ contactId: opp.contactId }] } } : {}),
        },
      })
      data.remindAt = startAt
      data.nextAction = `RDV : ${title}`
      activityType = 'MEETING_SET'
      activityTitle = 'RDV pris'
      activityDescription = title
      break
    }

    case 'NOTE': {
      if (!payload.note) throw new ProspectActionError('NOTE_REQUIRED', 'Une note est requise')
      activityType = 'NOTE'
      activityTitle = 'Note'
      activityDescription = payload.note
      break
    }

    case 'NEXT_ACTION': {
      if (!payload.remindAt) throw new ProspectActionError('REMIND_AT_REQUIRED', 'Une date est requise')
      if (!payload.nextAction) throw new ProspectActionError('NEXT_ACTION_REQUIRED', 'Un libellé est requis')
      data.remindAt = new Date(payload.remindAt)
      data.nextAction = payload.nextAction
      activityType = 'NEXT_ACTION_SET'
      activityTitle = `Prochaine action : ${payload.nextAction}`
      break
    }

    case 'QUALIFICATION': {
      if (!payload.criteria || typeof payload.criteria !== 'object' || Array.isArray(payload.criteria)) {
        throw new ProspectActionError('VALIDATION_ERROR', 'criteria est requis')
      }
      const refError = await checkReferences(
        Object.keys(payload.criteria).map(k => ({ domain: 'qualification_criteria', value: k }))
      )
      if (refError) throw new ProspectActionError('INVALID_REFERENCE', refError)
      const current: Record<string, boolean | null> = opp.qualification ? JSON.parse(opp.qualification) : {}
      for (const [k, v] of Object.entries(payload.criteria)) current[k] = v
      data.qualification = JSON.stringify(current)
      activityType = 'QUALIFICATION'
      activityTitle = 'Grille de qualification mise à jour'
      break
    }

    case 'NOT_INTERESTED': {
      if (!payload.reason) throw new ProspectActionError('REASON_REQUIRED', 'Une raison est requise')
      const refError = await checkReferences([{ domain: 'not_interested_reasons', value: payload.reason }])
      if (refError) throw new ProspectActionError('INVALID_REFERENCE', refError)
      data.prospectStatus = 'NOT_INTERESTED'
      data.lostReason = payload.reason
      data.remindAt = null
      activityType = 'NOT_INTERESTED'
      activityTitle = 'Pas intéressé'
      activityDescription = payload.note ?? undefined
      break
    }

    case 'REOPEN': {
      data.prospectStatus = 'TODO'
      data.lostReason = null
      activityType = 'REOPEN'
      activityTitle = 'Prospect réouvert'
      break
    }
  }

  data.lastActivityAt = new Date()
  // Auto-attribution : la première action sur une fiche non assignée l'attribue à son auteur.
  if (!opp.assignedToId) data.assignedToId = userId

  const updated = await prisma.opportunity.update({
    where: { id: opportunityId },
    data: data as Parameters<typeof prisma.opportunity.update>[0]['data'],
  })

  await prisma.activity.create({
    data: {
      type: activityType,
      title: activityTitle,
      description: activityDescription,
      userId,
      opportunityId,
      contactId: opp.contactId ?? undefined,
      companyId: opp.companyId ?? undefined,
      completedAt: new Date(),
    },
  })

  return updated
}
