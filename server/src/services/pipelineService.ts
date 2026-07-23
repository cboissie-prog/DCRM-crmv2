import prisma from '../prisma/client'

/** Injecte les étapes WON et LOST si elles sont absentes du pipeline (idempotent). */
export async function ensureWonLostStages(pipelineId: string): Promise<boolean> {
  const existing = await prisma.pipelineStage.findMany({ where: { pipelineId }, select: { isWon: true, isLost: true } })
  const hasWon  = existing.some(s => s.isWon)
  const hasLost = existing.some(s => s.isLost)

  if (!hasWon) {
    await prisma.pipelineStage.create({
      data: { pipelineId, key: 'WON', name: 'Gagné', color: '#10b981', isWon: true, isLost: false, order: 9998 },
    })
  }
  if (!hasLost) {
    await prisma.pipelineStage.create({
      data: { pipelineId, key: 'LOST', name: 'Perdu', color: '#ef4444', isWon: false, isLost: true, order: 9999 },
    })
  }
  return !hasWon || !hasLost
}

/**
 * Rattrapage : garantit que TOUS les pipelines (templates inclus) possèdent leurs
 * étapes Gagné/Perdu. Appelé au démarrage du serveur — couvre les pipelines créés
 * avant l'introduction de ce mécanisme. Retourne le nombre de pipelines complétés.
 */
export async function ensureWonLostStagesForAllPipelines(): Promise<number> {
  const pipelines = await prisma.pipeline.findMany({ select: { id: true } })
  let fixed = 0
  for (const p of pipelines) {
    if (await ensureWonLostStages(p.id)) fixed++
  }
  return fixed
}

/**
 * Clés d'étapes gagnées/perdues, dérivées des flags isWon/isLost de tous les
 * pipelines. Les clés historiques 'WON'/'LOST' sont toujours incluses par
 * sécurité (anciennes opportunités dont l'étape n'existe plus).
 */
export async function getWonLostStageKeys(): Promise<{ wonKeys: string[]; lostKeys: string[] }> {
  const stages = await prisma.pipelineStage.findMany({
    where: { OR: [{ isWon: true }, { isLost: true }] },
    select: { key: true, isWon: true, isLost: true },
  })
  const wonKeys  = [...new Set(['WON',  ...stages.filter(s => s.isWon).map(s => s.key)])]
  const lostKeys = [...new Set(['LOST', ...stages.filter(s => s.isLost).map(s => s.key)])]
  return { wonKeys, lostKeys }
}

/**
 * Copie tous les pipelines templates actifs vers un nouvel utilisateur.
 * Appelé à la création d'un compte (admin POST /users).
 *
 * Chaque template `isTemplate:true, isActive:true` (avec ses étapes) est cloné
 * en un pipeline personnel `ownerId=userId, isTemplate:false`.
 */
export async function copyTemplatesToUser(userId: string): Promise<void> {
  const templates = await prisma.pipeline.findMany({
    where: { isTemplate: true, isActive: true },
    include: { stages: { orderBy: { order: 'asc' } } },
    orderBy: { order: 'asc' },
  })

  for (const tpl of templates) {
    await prisma.pipeline.create({
      data: {
        name:        tpl.name,
        description: tpl.description ?? undefined,
        color:       tpl.color,
        isDefault:   tpl.isDefault,
        order:       tpl.order,
        ownerId:     userId,
        isTemplate:  false,
        stages: {
          create: tpl.stages.map(s => ({
            key:    s.key,
            name:   s.name,
            color:  s.color,
            order:  s.order,
            isWon:  s.isWon,
            isLost: s.isLost,
          })),
        },
      },
    })
  }
}
