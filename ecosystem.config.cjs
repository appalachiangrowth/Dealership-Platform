/**
 * PM2: keeps the four apps running on the VPS and starts them again after a crash or a reboot.
 *   pm2 start ecosystem.config.cjs      (first time)
 *   pm2 reload ecosystem.config.cjs     (after a new release)
 *   pm2 save && pm2 startup             (start everything when the server boots)
 * Each app reads its own .env / .env.local in its folder.
 */
module.exports = {
  apps: [
    {
      name: 'api',
      cwd: './backend',
      script: 'dist/main.js',
      node_args: '--max-old-space-size=1024',
      env: { NODE_ENV: 'production' },
      // the API runs the Facebook Chromes: give it time to close them cleanly (logins stay saved) …
      kill_timeout: 20000,
      // … and never restart it just because the server is busy; Chrome memory is managed by the API itself
      max_restarts: 50,
      restart_delay: 3000,
      exp_backoff_restart_delay: 2000,
      time: true,
      // Optional — show Facebook a normal (not headless) Chrome on a virtual screen. Needs: apt install xvfb
      // and FB_HEADLESS=false in backend/.env. Then use these two lines instead of "script" above:
      // script: '/usr/bin/xvfb-run',
      // args: '-a --server-args="-screen 0 1440x1000x24" node dist/main.js',
    },
    {
      name: 'portal',
      cwd: './dealer-portal',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000 -H 127.0.0.1',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      time: true,
    },
    {
      name: 'admin',
      cwd: './admin',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001 -H 127.0.0.1',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '500M',
      time: true,
    },
    {
      name: 'websites',
      cwd: './frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002 -H 127.0.0.1',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '700M',
      time: true,
    },
  ],
};
