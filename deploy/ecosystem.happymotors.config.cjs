/**
 * PM2 for Happy Motors (https://happymotors1.com + https://happymotors1.com/admin) — separate from Peerless and the
 * multi-dealer apps. Run from /var/www/dealer-platform:
 *   pm2 start deploy/ecosystem.happymotors.config.cjs     (first time)
 *   pm2 reload deploy/ecosystem.happymotors.config.cjs    (after a new build)
 *   pm2 save
 * Each app reads its own .env.local (create it before `npm run build`: NEXT_PUBLIC_* values are built in).
 */
const path = require('path');
const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'happymotors-site',
      cwd: path.join(root, 'happy-motors-frontend/frontend'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3005 -H 127.0.0.1',
      env: { NODE_ENV: 'production', PORT: '3005' },
      max_memory_restart: '600M',
      time: true,
    },
    {
      name: 'happymotors-admin',
      cwd: path.join(root, 'dealer-portal-happymotors/dealer-portal'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3006 -H 127.0.0.1',
      env: { NODE_ENV: 'production', PORT: '3006' },
      max_memory_restart: '600M',
      time: true,
    },
  ],
};
