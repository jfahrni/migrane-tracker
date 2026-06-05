#!/bin/sh
set -e

chown -R www-data:www-data /app/data 2>/dev/null || chmod -R a+w /app/data 2>/dev/null || true

PRISMA_CLI="node ./node_modules/prisma/build/index.js"
export DATABASE_URL="file:/app/data/prod.db"

echo "→ Datenbankmigrationen anwenden..."
su-exec www-data sh -c "$PRISMA_CLI migrate resolve --applied '20260605000000_init' --schema ./prisma/schema.prisma" 2>/dev/null || true
su-exec www-data sh -c "$PRISMA_CLI migrate deploy --schema ./prisma/schema.prisma"

echo "→ App starten..."
exec su-exec www-data node server.js
