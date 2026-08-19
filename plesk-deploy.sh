#!/bin/sh
# Déploiement production (VPS OVH + Plesk).
# Appelé par l'action de déploiement Git de Plesk en UNE seule ligne :
#
#   DATABASE_URL="postgresql://..." sh plesk-deploy.sh
#
# (Plesk exécute chaque ligne du champ dans un shell séparé — d'où le one-liner.)
# Le script localise lui-même le Node installé par Plesk (/opt/plesk/node/*) en
# préférant une LTS (24, 22). Un préfixe PATH=/opt/plesk/node/<v>/bin:$PATH dans
# l'action reste possible pour forcer une version précise.
# ⚠️ Node 25 est End-of-Life depuis le 01/06/2026 — installer une LTS (24 ou 22)
#    dans l'écran Node.js de Plesk.
set -eu

cd "$(dirname "$0")"

# ─── Localiser Node (l'action Plesk n'hérite pas du PATH de l'app Node.js) ───
if ! command -v node >/dev/null 2>&1; then
  for v in 24 22; do
    if [ -x "/opt/plesk/node/$v/bin/node" ]; then
      PATH="/opt/plesk/node/$v/bin:$PATH"; export PATH
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1 && [ -d /opt/plesk/node ]; then
  # Dernier recours : la plus haute version installée, LTS ou non.
  v=$(ls /opt/plesk/node | sort -n | tail -1)
  if [ -n "$v" ] && [ -x "/opt/plesk/node/$v/bin/node" ]; then
    PATH="/opt/plesk/node/$v/bin:$PATH"; export PATH
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "❌ node introuvable. Versions Plesk présentes dans /opt/plesk/node :" >&2
  ls /opt/plesk/node >&2 2>/dev/null || echo "   (répertoire absent — installer Node via Plesk > Node.js)" >&2
  echo "   Sinon, préfixer l'action de déploiement : PATH=/opt/plesk/node/<version>/bin:\$PATH" >&2
  exit 1
fi

# Avertit si la version n'est pas une LTS maintenue (impaire = ligne "Current" EOL rapide).
NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
case "$NODE_MAJOR" in ''|*[!0-9]*) NODE_MAJOR=0 ;; esac
if [ "$NODE_MAJOR" -lt 22 ] || [ $((NODE_MAJOR % 2)) -eq 1 ]; then
  echo "⚠️  ATTENTION : Node $(node -v) n'est pas une LTS maintenue — utiliser Node 24 ou 22." >&2
fi

# ─── Garde-fou DATABASE_URL ──────────────────────────────
# migrate deploy + seed lisent DATABASE_URL (env ou server/.env). Sans URL postgres,
# Prisma retomberait sur le SQLite de dev — on refuse plutôt que de migrer à vide.
if [ -z "${DATABASE_URL:-}" ] && ! grep -qs 'DATABASE_URL=.*postgres' server/.env; then
  echo "❌ DATABASE_URL manquante. Ajouter dans l'action de déploiement :" >&2
  echo "   DATABASE_URL=\"postgresql://...\" sh plesk-deploy.sh" >&2
  echo "   (recopier la valeur configurée dans l'écran Node.js de Plesk)" >&2
  exit 1
fi

echo "── Node $(node -v) / npm $(npm -v)"

echo "── API : install + prisma + build"
cd server
npm install
npm run db:schema:postgres
./node_modules/.bin/prisma generate --schema=src/prisma/schema.postgres.prisma
npm run build
./node_modules/.bin/prisma migrate deploy --schema=src/prisma/schema.postgres.prisma
# Seed idempotent : synchronise permissions + rôles (n'écrase jamais l'admin existant)
npm run db:seed

echo "── Front : install + build"
cd ../client
npm install
npm run build

echo "── Redémarrage Passenger"
cd ..
# Passenger surveille <app_root>/tmp/restart.txt. Selon la configuration Plesk,
# l'app root est la racine du dépôt (fichier de démarrage server/dist/index.js)
# ou le dossier server/ : on touche les deux, sinon l'ancien process reste en
# mémoire et sert une API obsolète alors que le front statique, lui, est à jour.
mkdir -p tmp server/tmp
touch tmp/restart.txt server/tmp/restart.txt

echo "── Déploiement terminé"
echo "   API compilée le : $(date -r server/dist/index.js '+%d/%m/%Y %H:%M:%S' 2>/dev/null || echo '?')"
echo "   Routes présentes dans le build : $(ls server/dist/routes 2>/dev/null | wc -l)"
echo "   ⚠️  Si l'API répond encore 'Route introuvable' sur une route récente,"
echo "      redémarrer l'application depuis Plesk > Node.js > Redémarrer."
