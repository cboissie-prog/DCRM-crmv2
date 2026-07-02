import prisma from '../prisma/client'

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
