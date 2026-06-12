/**
 * Chiffrement AES-256-GCM pour les tokens sensibles (refresh tokens Google, etc.)
 *
 * Clé : variable d'environnement TOKEN_ENC_KEY (hex 64 chars = 32 octets).
 * Générer une clé de production : openssl rand -hex 32
 *
 * Format stocké : "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12   // 96 bits, recommandé pour GCM
const TAG_LENGTH = 16  // 128 bits

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY
  if (!raw) {
    throw new Error('[crypto] TOKEN_ENC_KEY absent — définissez cette variable dans .env (openssl rand -hex 32)')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('[crypto] TOKEN_ENC_KEY invalide — doit être 64 caractères hexadécimaux (32 octets)')
  }
  return Buffer.from(raw, 'hex')
}

/** Chiffre `plain` et renvoie le payload "<iv>:<authTag>:<ciphertext>" en hex */
export function encrypt(plain: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/** Déchiffre un payload "<iv>:<authTag>:<ciphertext>" en hex et renvoie le texte clair */
export function decrypt(payload: string): string {
  const key = getKey()
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('[crypto] Payload invalide — format attendu : iv:authTag:ciphertext')
  }
  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}
