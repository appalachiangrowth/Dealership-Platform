#!/usr/bin/env bash
# =====================================================================================================
#  Dealer Platform — one-time server setup for a fresh Contabo VPS (Ubuntu 24.04 / 22.04, x86_64)
#  Run as root:   bash deploy/contabo-setup.sh
#  It installs: Node.js 22, PostgreSQL, Google Chrome (for FB Poster) + fonts, Nginx, Certbot, PM2,
#  a 4 GB swap file and the firewall. It does NOT copy your code — see deploy/DEPLOY-CONTABO.md.
# =====================================================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-dealer_platform}"
DB_USER="${DB_USER:-dealer}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
APP_USER="${APP_USER:-dealer}"

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates gnupg git ufw unzip build-essential nginx certbot python3-certbot-nginx

echo "==> Swap (4 GB): keeps the server alive when several Facebook browsers start at once"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "==> Node.js 22"
if ! command -v node >/dev/null || ! node -v | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> PostgreSQL"
apt-get install -y postgresql
systemctl enable --now postgresql
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "==> Google Chrome + libraries + fonts (FB Poster; emoji in posts)"
if ! command -v google-chrome >/dev/null; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -y
  apt-get install -y google-chrome-stable
fi
apt-get install -y fonts-liberation fonts-noto-color-emoji fonts-noto-cjk xvfb

echo "==> App user"
id -u "${APP_USER}" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "${APP_USER}"

echo "==> Firewall: SSH + web only (the apps listen on 127.0.0.1 behind Nginx)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
echo "================================================================================"
echo " Done. Database:  postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
echo " (write it down — it goes into backend/.env as DATABASE_URL)"
echo " Chrome:          $(command -v google-chrome)   (CHROME_PATH in backend/.env)"
echo " Next: follow deploy/DEPLOY-CONTABO.md from step 2 as user '${APP_USER}'."
echo "================================================================================"
