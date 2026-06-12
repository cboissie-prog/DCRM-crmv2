/**
 * FICHIER GÉNÉRÉ par scripts/make-postgres-schema.mjs — ne pas éditer à la main
 * (Ce commentaire s'applique au fichier de sortie ; ce script source est versionné.)
 *
 * Dérive src/prisma/schema.postgres.prisma depuis src/prisma/schema.prisma
 * en substituant le provider SQLite par PostgreSQL.
 *
 * Usage : node scripts/make-postgres-schema.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '..');

const srcPath  = resolve(serverRoot, 'src/prisma/schema.prisma');
const destPath = resolve(serverRoot, 'src/prisma/schema.postgres.prisma');

const GENERATED_HEADER = `// ============================================================
// FICHIER GÉNÉRÉ par scripts/make-postgres-schema.mjs
// NE PAS ÉDITER À LA MAIN — modifier schema.prisma puis relancer :
//   node scripts/make-postgres-schema.mjs
// ============================================================
`;

let source = readFileSync(srcPath, 'utf8');

// 1. Remplace provider = "sqlite" par provider = "postgresql"
source = source.replace(
  /provider\s*=\s*"sqlite"/,
  'provider = "postgresql"'
);

// 2. Remplace le commentaire d'en-tête du datasource s'il existe
source = source.replace(
  /\/\/ Dev = SQLite\..*?\.[\r\n]/,
  '// Production = PostgreSQL (schéma dérivé — voir scripts/make-postgres-schema.mjs)\n'
);

// 3. Préfixe le fichier avec l'en-tête généré
const output = GENERATED_HEADER + source;

writeFileSync(destPath, output, 'utf8');

console.log(`[make-postgres-schema] ✓ Écrit : ${destPath}`);
console.log(`[make-postgres-schema]   Source : ${srcPath}`);
