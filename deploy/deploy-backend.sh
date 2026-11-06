#!/usr/bin/env bash
# =====================================================================================================
#  Zero-Downtime Deployment Script for Backend Service
#  Target: /var/www/dealer-platform/backend
# =====================================================================================================
set -euo pipefail

APP_DIR="/var/www/dealer-platform"
BACKEND_DIR="${APP_DIR}/backend"

echo "==> Navigating to ${APP_DIR}..."
cd "${APP_DIR}"

echo "==> Fetching latest changes from origin/main..."
git fetch origin main
git reset --hard origin/main

echo "==> Deploying backend service..."
cd "${BACKEND_DIR}"

# Ensure production dependencies & prisma client
echo "==> Installing dependencies..."
npm install --omit=dev --ignore-scripts=false
echo "==> Generating Prisma client..."
npx prisma generate

# Note: We do NOT run prisma db push or migrations because production database
# (e.g. Supabase) already has all tables and live production data.

echo "==> Building backend..."
npm run build

echo "==> Zero-downtime reload with PM2..."
if pm2 describe dealer-platform-backend > /dev/null 2>&1; then
  pm2 reload dealer-platform-backend --update-env
else
  pm2 start dist/main.js --name "dealer-platform-backend" --time
fi

pm2 save

echo "==> Backend deployment successful!"
pm2 show dealer-platform-backend
