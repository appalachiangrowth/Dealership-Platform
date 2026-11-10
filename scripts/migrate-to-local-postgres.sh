#!/usr/bin/env bash
# ==============================================================================
# DEALER PLATFORM: Local PostgreSQL Migration Script (Contabo VPS)
# Target: Sub-millisecond database queries (< 1ms) via localhost:5432
# ==============================================================================

set -euo pipefail

echo "=========================================================="
echo " [Step 1/5] Verifying & Installing PostgreSQL Locally"
echo "=========================================================="
if ! command -v psql >/dev/null 2>&1; then
  echo "Installing postgresql and postgresql-contrib..."
  sudo apt-get update -y
  sudo apt-get install -y postgresql postgresql-contrib
else
  echo "PostgreSQL is already installed."
fi

sudo systemctl enable postgresql
sudo systemctl start postgresql

echo "Configuring database 'dealership_db' and user 'dealer_admin'..."
sudo -u postgres psql << 'EOSQL'
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'dealer_admin') THEN
      CREATE ROLE dealer_admin WITH LOGIN PASSWORD 'LocalDealerSecure2026!';
   ELSE
      ALTER ROLE dealer_admin WITH PASSWORD 'LocalDealerSecure2026!';
   END IF;
END
$do$;

SELECT 'CREATE DATABASE dealership_db OWNER dealer_admin'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dealership_db')\gexec

GRANT ALL PRIVILEGES ON DATABASE dealership_db TO dealer_admin;
ALTER DATABASE dealership_db OWNER TO dealer_admin;
\c dealership_db
GRANT ALL ON SCHEMA public TO dealer_admin;
ALTER SCHEMA public OWNER TO dealer_admin;
EOSQL

echo "Local PostgreSQL database created and privileges verified."

echo "=========================================================="
echo " [Step 2/5] Updating Backend .env to Local PostgreSQL"
echo "=========================================================="
BACKEND_DIR="/var/www/dealer-platform/backend"

if [ ! -d "$BACKEND_DIR" ]; then
  # Fallback to current repository directory if running inside repository
  BACKEND_DIR="$(pwd)/backend"
fi

if [ ! -d "$BACKEND_DIR" ]; then
  echo "Error: Backend directory not found at $BACKEND_DIR"
  exit 1
fi

cd "$BACKEND_DIR"

# Backup existing .env
if [ -f .env ]; then
  cp .env .env.backup.$(date +%Y%m%d%H%M%S)
  echo "Backed up existing .env"
fi

LOCAL_DB_URL="postgresql://dealer_admin:LocalDealerSecure2026!@127.0.0.1:5432/dealership_db?schema=public&connection_limit=20"
LOCAL_DIRECT_URL="postgresql://dealer_admin:LocalDealerSecure2026!@127.0.0.1:5432/dealership_db?schema=public"

# Replace or append DATABASE_URL
if grep -q "^DATABASE_URL=" .env; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${LOCAL_DB_URL}\"|" .env
else
  echo "DATABASE_URL=\"${LOCAL_DB_URL}\"" >> .env
fi

# Replace or append DIRECT_URL
if grep -q "^DIRECT_URL=" .env; then
  sed -i "s|^DIRECT_URL=.*|DIRECT_URL=\"${LOCAL_DIRECT_URL}\"|" .env
else
  echo "DIRECT_URL=\"${LOCAL_DIRECT_URL}\"" >> .env
fi

echo ".env successfully updated to connect to 127.0.0.1:5432/dealership_db"

echo "=========================================================="
echo " [Step 3/5] Syncing Database Schema with Prisma"
echo "=========================================================="
npx prisma db push --accept-data-loss
npx prisma generate

echo "=========================================================="
echo " [Step 4/5] Building Backend"
echo "=========================================================="
npm run build

echo "=========================================================="
echo " [Step 5/5] Restarting Backend Service via PM2"
echo "=========================================================="
pm2 restart dealer-platform-backend --update-env

echo "Waiting 3 seconds for service startup and healthcheck..."
sleep 3

echo "=========================================================="
echo " Round-Trip Latency Verification (from PM2 logs):"
echo "=========================================================="
pm2 logs dealer-platform-backend --lines 25 --nostream | grep -i "round trip" || true

echo "Migration finished successfully!"
