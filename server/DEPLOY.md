# Guide de déploiement — DCRM Server

## Variables d'environnement requises

```env
# Base de données
DATABASE_URL=postgresql://user:password@host:5432/dcrm

# Auth JWT
JWT_SECRET=<secret_fort_64_chars>
JWT_REFRESH_SECRET=<secret_fort_64_chars>

# VoIP webhook
VOIP_WEBHOOK_SECRET=<secret>

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=<password>
SMTP_FROM="DCRM <noreply@example.com>"

# Premier seed (optionnel — mot de passe de l'admin initial)
ADMIN_INITIAL_PASSWORD=<mot_de_passe>

# Logs
LOG_LEVEL=info   # debug | info | warn | error

# ─── Intégration Google (optionnelle — voir GOOGLE-SETUP.md) ─────────────────
GOOGLE_CLIENT_ID=<client_id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client_secret>
GOOGLE_REDIRECT_URI=https://votre-domaine.com/api/auth/google/callback
GOOGLE_CALENDAR_REDIRECT_URI=https://votre-domaine.com/api/google/calendar/callback
TOKEN_ENC_KEY=<64_hex_chars>   # openssl rand -hex 32
FRONTEND_URL=https://votre-domaine.com
```

> Les variables Google sont optionnelles. Si `GOOGLE_CLIENT_ID` ou `GOOGLE_CLIENT_SECRET`
> sont absentes, les routes `/api/auth/google` et `/api/google/*` répondent `503 GOOGLE_DISABLED`
> sans bloquer le reste de l'application.

---

## Intégration Google

La configuration complète (Google Cloud Console, scopes, URIs, settings applicatifs,
fonctionnement de la synchro Calendar) est documentée dans **[GOOGLE-SETUP.md](../GOOGLE-SETUP.md)**
à la racine du dépôt.

## Workflows

### Développement (SQLite local)

```bash
cd server

# Démarrer l'API en mode watch
npm run dev

# Synchroniser le schéma sans migration (dev rapide)
npm run db:push

# Remplir la base avec des données démo
npm run db:seed
```

### Modifier le schéma et créer une migration versionnée

1. Éditer `src/prisma/schema.prisma` (modèles, champs, index)
2. Dériver le schéma PostgreSQL :
   ```bash
   npm run db:schema:postgres
   # → génère src/prisma/schema.postgres.prisma
   ```
3. Valider le schéma postgres :
   ```bash
   npx prisma validate --schema=src/prisma/schema.postgres.prisma
   ```
4. Créer la migration (requiert une base PostgreSQL accessible) :
   ```bash
   DATABASE_URL=postgresql://... npm run db:migrate
   # → crée src/prisma/migrations/<timestamp>_<nom>/migration.sql
   ```
5. Committer `schema.prisma`, `schema.postgres.prisma` **et** le dossier `migrations/`.

> En dev SQLite, continuer à utiliser `npm run db:push` pour itérer rapidement ;
> les fichiers de migration ne sont créés que contre PostgreSQL.

---

## Premier déploiement en production

### Cas A — Base vierge (aucune table existante)

```bash
# Déploie toutes les migrations dans l'ordre depuis 0_init
npm run db:migrate:deploy
```

### Cas B — Base déjà structurée (DB existante avec les tables en place)

La migration `0_init` décrit l'état initial. Si la base est déjà à cet état,
il faut la marquer comme déjà appliquée (baseline) **sans** exécuter le SQL :

```bash
npx prisma migrate resolve \
  --applied 0_init \
  --schema=src/prisma/schema.postgres.prisma
```

Puis déployer les éventuelles migrations suivantes normalement :

```bash
npm run db:migrate:deploy
```

### Démarrage complet en production

```bash
npm run build        # compile TypeScript → dist/
npm run start:prod   # génère schema.postgres.prisma → prisma generate → migrate deploy → node dist/index.js
```

`start:prod` enchaîne automatiquement :
1. `db:schema:postgres` — regénère `schema.postgres.prisma` depuis la source
2. `prisma generate --schema=src/prisma/schema.postgres.prisma` — regénère le client Prisma
3. `prisma migrate deploy --schema=src/prisma/schema.postgres.prisma` — applique les migrations en attente
4. `node dist/index.js` — démarre le serveur

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/prisma/schema.prisma` | Source de vérité (SQLite dev) — **seul fichier à modifier** |
| `src/prisma/schema.postgres.prisma` | Dérivé automatiquement — ne pas éditer |
| `src/prisma/migrations/migration_lock.toml` | Verrouille le provider à `postgresql` |
| `src/prisma/migrations/0_init/migration.sql` | Baseline — structure complète initiale |
| `scripts/make-postgres-schema.mjs` | Script de dérivation SQLite → PostgreSQL |
