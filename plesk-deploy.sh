#!/bin/sh
# Déploiement production (VPS OVH + Plesk).
# Appelé par l'action de déploiement Git de Plesk en UNE seule ligne :
#
#   PATH=/opt/plesk/node/25/bin:$PATH DATABASE_URL="postgresql://..." sh plesk-deploy.sh
#
# (Plesk exécute chaque ligne du champ dans un shell séparé — d'où le one-liner.)
set -eu

cd "$(dirname "$0")"

echo "── Node $(node -v) / npm $(npm -v)"

echo "── API : install + prisma + build"
cd server
npm install
npm run db:schema:postgres
./node_modules/.bin/prisma generate --schema=src/prisma/schema.postgres.prisma
npm run build
./node_modules/.bin/prisma migrate deploy --schema=src/prisma/schema.postgres.prisma

echo "── Front : install + build"
cd ../client
npm install
npm run build

echo "── Redémarrage Passenger"
cd ..
mkdir -p server/tmp
touch server/tmp/restart.txt

echo "── Déploiement terminé"
