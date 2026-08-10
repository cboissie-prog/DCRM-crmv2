import { z } from 'zod'

/**
 * Politique de mot de passe partagée (création, changement, reset).
 * Minimum 10 caractères avec au moins une minuscule, une majuscule et un chiffre.
 * Volontairement raisonnable pour ne pas bloquer les utilisateurs, tout en écartant
 * les mots de passe triviaux les plus courants et le pur bruteforce de mots courts.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit contenir au moins 10 caractères')
  .refine((v) => /[a-z]/.test(v), 'Le mot de passe doit contenir au moins une minuscule')
  .refine((v) => /[A-Z]/.test(v), 'Le mot de passe doit contenir au moins une majuscule')
  .refine((v) => /[0-9]/.test(v), 'Le mot de passe doit contenir au moins un chiffre')
