#!/bin/sh
# Déploiement production (VPS OVH + Plesk).
# Appelé par l'action de déploiement Git de Plesk en UNE seule ligne :
#
#   PATH=/opt/plesk/node/24/bin:$PATH DATABASE_URL="postgresql://..." sh plesk-deploy.sh
#
# (Plesk exécute chaque ligne du champ dans un shell séparé — d'où le one-liner.)
# ⚠️ Utiliser une version LTS de Node (24 ou 22). Node 25 est End-of-Life depuis
#    le 01/06/2026 et ne reçoit plus de correctifs de sécurité.
set -eu

# Refuse de déployer sur une version de Node non maintenue (impaire = ligne "Current" EOL rapide).
NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ] || [ $((NODE_MAJOR % 2)) -eq 1 ]; then
  echo "⚠️  ATTENTION : Node $(node -v) n'est pas une LTS maintenue — utiliser Node 24 ou 22." >&2
fi

cd "$(dirname "$0")"

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
mkdir -p server/tmp
touch server/tmp/restart.txt

echo "── Déploiement terminé"
