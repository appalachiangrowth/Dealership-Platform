#!/usr/bin/env bash
# =====================================================================================================
#  Dealer Platform — One-Command Production Setup for Contabo VPS (Ubuntu 22.04 / 24.04 LTS)
#  Target Host: 5.183.35.10
#  Deployment Target: /var/www/dealer-platform
# =====================================================================================================
set -euo pipefail

DEPLOY_DIR="/var/www/dealer-platform"
DB_NAME="${DB_NAME:-dealer_platform}"
DB_USER="${DB_USER:-dealer}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
APP_PORT="${APP_PORT:-4000}"

echo "================================================================================"
echo "==> Step 1: System Packages & Dependencies"
echo "================================================================================"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg git ufw unzip build-essential nginx certbot python3-certbot-nginx

# Configure 4GB Swap file (critical for browser automation / puppeteer stability)
if ! swapon --show | grep -q '/swapfile'; then
  echo "==> Creating 4GB swap space..."
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "================================================================================"
echo "==> Step 2: Node.js (v20 LTS), PM2 & Docker Engine"
echo "================================================================================"
# Node.js 20 LTS
if ! command -v node >/dev/null || ! node -v | grep -q '^v20\.'; then
  echo "==> Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# PM2 Process Manager
npm install -g pm2

# Docker & Docker Compose
if ! command -v docker >/dev/null; then
  echo "==> Installing Docker and Docker Compose..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

echo "================================================================================"
echo "==> Step 3: PostgreSQL Database Setup"
echo "================================================================================"
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "================================================================================"
echo "==> Step 4: Google Chrome & Dependencies (for Facebook Marketplace automation)"
echo "================================================================================"
if ! command -v google-chrome >/dev/null; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -y
  apt-get install -y google-chrome-stable
fi
apt-get install -y fonts-liberation fonts-noto-color-emoji fonts-noto-cjk xvfb

echo "================================================================================"
echo "==> Step 5: UFW Firewall Configuration"
echo "================================================================================"
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow ${APP_PORT}/tcp comment 'Backend API'
ufw --force enable

echo "================================================================================"
echo "==> Step 6: Initialize Deployment Directory"
echo "================================================================================"
mkdir -p "${DEPLOY_DIR}"

# Clone repository if empty, or pull if exists
if [ ! -d "${DEPLOY_DIR}/.git" ]; then
  echo "==> Cloning repository into ${DEPLOY_DIR}..."
  git clone https://github.com/appalachiangrowth/Dealership-Platform.git "${DEPLOY_DIR}"
else
  echo "==> Updating repository in ${DEPLOY_DIR}..."
  cd "${DEPLOY_DIR}" && git pull origin main
fi

cd "${DEPLOY_DIR}"

# Initialize backend .env if not present
if [ ! -f "${DEPLOY_DIR}/backend/.env" ]; then
  echo "==> Initializing ${DEPLOY_DIR}/backend/.env..."
  JWT_RANDOM=$(openssl rand -hex 48)
  cat > "${DEPLOY_DIR}/backend/.env" <<EOF
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
PORT=${APP_PORT}
JWT_SECRET="${JWT_RANDOM}"
JWT_EXPIRES_IN="7d"
DEFAULT_TENANT="blue-motors"
SETUP_KEY=""
CARGURUS_CRON_HOUR="3"
HOST="127.0.0.1"
CHROME_PATH="/usr/bin/google-chrome"
FB_STORAGE_DIR="${DEPLOY_DIR}/backend/storage/facebook"
FB_HEADLESS=true
EOF
  echo "==> Created backend/.env with generated secrets."
fi

echo "================================================================================"
echo "==> Step 7: Build & Launch with PM2"
echo "================================================================================"
cd "${DEPLOY_DIR}/backend"
npm install
npx prisma generate
npx prisma db push
npm run build

# Start or reload via PM2
if pm2 list | grep -q "dealer-platform-backend"; then
  echo "==> Reloading dealer-platform-backend in PM2..."
  pm2 reload dealer-platform-backend --update-env
else
  echo "==> Starting dealer-platform-backend in PM2..."
  pm2 start dist/main.js --name "dealer-platform-backend" --time
fi

# Enable PM2 auto-restart on boot
pm2 startup systemd -u root --hp /root || true
pm2 save

echo "================================================================================"
echo " Setup complete!"
echo " Backend Status: $(pm2 show dealer-platform-backend | grep status || true)"
echo " Database URL:   postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
echo " API Port:       ${APP_PORT}"
echo "================================================================================"
