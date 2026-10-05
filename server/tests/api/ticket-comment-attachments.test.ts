/**
 * ticket-comment-attachments.test.ts — pièces jointes rattachées aux commentaires de ticket
 * (POST /tickets/:id/comments en JSON ou multipart/form-data), cf. spec §5 :
 * docs/superpowers/specs/2026-10-05-ticket-thread-design.md
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { createApp } from '../../src/app'
import { loginAs } from '../helpers'
import { PrismaClient } from '@prisma/client'

const app = createApp({ rateLimit: false })
const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@crm.local'
const ADMIN_PASSWORD = 'test-admin-pwd-123'

const uploadsDir = path.join(process.cwd(), 'uploads', 'tickets')

let adminToken: string
let ticketId: string
const storedNamesToCleanup: string[] = []

async function createTicket(token: string) {
  const res = await request(app)
    .post('/api/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Ticket pièces jointes de commentaire', description: 'Desc test', category: 'OTHER' })
  return res.body.data.id as string
}

describe('Tickets — pièces jointes rattachées aux commentaires', () => {
  beforeAll(async () => {
    const { accessToken } = await loginAs(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    adminToken = accessToken
    ticketId = await createTicket(adminToken)
  })

  afterAll(async () => {
    for (const name of storedNamesToCleanup) {
      await fs.promises.unlink(path.join(uploadsDir, name)).catch(() => {})
    }
    await prisma.ticketAttachment.deleteMany({ where: { ticketId } })
    await prisma.ticketComment.deleteMany({ where: { ticketId } })
    await prisma.ticket.deleteMany({ where: { id: ticketId } })
    await prisma.$disconnect()
  })

  it('commentaire JSON (inchangé) → 201, attachments vide', async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'Commentaire sans pièce jointe' })
    expect(res.status).toBe(201)
    expect(res.body.data.content).toBe('Commentaire sans pièce jointe')
    expect(res.body.data.attachments).toEqual([])
  })

  it('commentaire multipart avec un fichier .txt → 201, attachments.length === 1, fichier présent sur disque', async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('content', 'Voici un fichier')
      .attach('files', Buffer.from('hello'), 'note.txt')
    expect(res.status).toBe(201)
    expect(res.body.data.attachments).toHaveLength(1)

    const att = res.body.data.attachments[0]
    expect(att).toMatchObject({ filename: 'note.txt' })
    expect(att).toHaveProperty('id')
    expect(att).toHaveProperty('mimeType')
    expect(att).toHaveProperty('size')
    expect(att).toHaveProperty('createdAt')

    const dbAttachment = await prisma.ticketAttachment.findUnique({ where: { id: att.id } })
    expect(dbAttachment?.commentId).toBe(res.body.data.id)
    expect(dbAttachment).toBeTruthy()
    storedNamesToCleanup.push(dbAttachment!.storedName)
    expect(fs.existsSync(path.join(uploadsDir, dbAttachment!.storedName))).toBe(true)
  })

  it('multipart sans texte mais avec un fichier → 201', async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', Buffer.from('contenu du fichier'), 'piece.txt')
    expect(res.status).toBe(201)
    expect(res.body.data.attachments).toHaveLength(1)
    expect(res.body.data.content).toBe('')

    const dbAttachment = await prisma.ticketAttachment.findUnique({ where: { id: res.body.data.attachments[0].id } })
    storedNamesToCleanup.push(dbAttachment!.storedName)
  })

  it('multipart sans texte ni fichier → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('isInternal', 'false')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('type de fichier refusé (.exe) → 400 INVALID_FILE_TYPE, aucun commentaire créé', async () => {
    const before = await prisma.ticketComment.count({ where: { ticketId } })
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('content', 'Tentative avec exécutable')
      .attach('files', Buffer.from('x'), 'virus.exe')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE')
    const after = await prisma.ticketComment.count({ where: { ticketId } })
    expect(after).toBe(before)
  })

  it('GET /tickets/:id renvoie la pièce jointe dans comments[].attachments, pas dans attachments de premier niveau', async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.attachments).toEqual([])
    const comments = res.body.data.comments as Array<{ attachments: Array<{ filename: string }> }>
    const withAttachments = comments.filter(c => c.attachments.length > 0)
    expect(withAttachments.length).toBeGreaterThanOrEqual(2)
    const filenames = withAttachments.flatMap(c => c.attachments.map(a => a.filename))
    expect(filenames).toContain('note.txt')
    expect(filenames).toContain('piece.txt')
  })

  it('téléchargement de la pièce jointe → 200', async () => {
    const attachment = await prisma.ticketAttachment.findFirst({ where: { ticketId, filename: 'note.txt' } })
    expect(attachment).toBeTruthy()
    const res = await request(app)
      .get(`/api/tickets/attachments/${attachment!.id}/download`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
  })

  it('POST /tickets/:id/attachments (supprimée) → 404', async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('hello'), 'note.txt')
    expect(res.status).toBe(404)
  })
})
