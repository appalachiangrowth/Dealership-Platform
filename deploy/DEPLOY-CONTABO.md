# Going live on a Contabo VPS

One server runs everything: the API with the Facebook Chromes, PostgreSQL, the Dealership Portal, Platform Admin and
every dealer website. **Cloud VPS 10 (4 vCPU, 8 GB RAM)** is enough to start with: about 1.5 GB for the database, the
API and the websites, and about 450 MB for each Facebook browser that is open at the same time. Choose **Ubuntu 24.04**
when you order it.

Replace `yourcompany.com` everywhere with your own domain.

## 1. Prepare the server (once)

DNS: point these A records at the server's IP address: `api.`, `portal.`, `admin.` (and `*.sites.` if dealers without
a domain should get a sub-domain). Each dealer points their own domain at the same IP address.

```bash
ssh root@SERVER_IP
git clone <your repo> /home/dealer/dealer-platform     # or upload the folder (without node_modules / .next / dist)
cd /home/dealer/dealer-platform
bash deploy/contabo-setup.sh                            # Node 22, PostgreSQL, Chrome, Nginx, PM2, swap, firewall
chown -R dealer:dealer /home/dealer/dealer-platform
```
Write down the database line it prints at the end.

## 2. Settings

```bash
su - dealer
cd ~/dealer-platform
cp backend/rename-to-dot-env.txt backend/.env
nano backend/.env
```
* `DATABASE_URL` = the line from step 1
* `JWT_SECRET` = a new long random string (`openssl rand -hex 48`). **Never keep the example value.**
* `HOST=127.0.0.1`, `CHROME_PATH=/usr/bin/google-chrome`
* `SITES_DOMAIN=sites.yourcompany.com`: dealers without their own domain open at `https://<dealer-id>.sites.yourcompany.com`
  (needs the `*.sites` DNS record and a wildcard certificate, see step 4)
* `DEFAULT_TENANT`, `SETUP_KEY`, `CARGURUS_CRON_HOUR` as you need them

The three web apps (`cp rename-to-dot-env-local.txt .env.local` in each folder):

| Folder | Settings |
|---|---|
| `dealer-portal/.env.local` | `NEXT_PUBLIC_API_URL=https://api.yourcompany.com` · `NEXT_PUBLIC_PLATFORM_ADMIN_URL=https://admin.yourcompany.com` · `NEXT_PUBLIC_SITE_PATTERN=https://{id}.sites.yourcompany.com` |
| `admin/.env.local` | `NEXT_PUBLIC_API_URL=https://api.yourcompany.com` · `NEXT_PUBLIC_DEALER_PORTAL_URL=https://portal.yourcompany.com` · `NEXT_PUBLIC_SITE_PATTERN=https://{id}.sites.yourcompany.com` |
| `frontend/.env.local` | `API_URL=http://127.0.0.1:4000` · `ADMIN_URL=https://portal.yourcompany.com,https://admin.yourcompany.com` |

`NEXT_PUBLIC_…` values are built into the apps, so build again (step 3) after changing them.

## 3. Install, build, start

```bash
cd ~/dealer-platform
npm run install:all
(cd backend && npx prisma db push && npm run db:seed)   # creates / updates the tables, adds the 5 designs
npm run build
pm2 start ecosystem.config.cjs
pm2 save
exit                                                      # back to root
env PATH=$PATH:/usr/bin pm2 startup systemd -u dealer --hp /home/dealer   # start the apps when the server boots
```

## 4. Nginx + HTTPS

```bash
cp /home/dealer/dealer-platform/deploy/nginx-dealer-platform.conf /etc/nginx/sites-available/dealer-platform
nano /etc/nginx/sites-available/dealer-platform           # your domain names
ln -s /etc/nginx/sites-available/dealer-platform /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d api.yourcompany.com -d portal.yourcompany.com -d admin.yourcompany.com
certbot --nginx -d dealerdomain.com -d www.dealerdomain.com   # for each dealer domain
# *.sites.yourcompany.com needs a wildcard certificate (DNS check at your domain registrar):
certbot certonly --manual --preferred-challenges dns -d '*.sites.yourcompany.com'
```
Open `https://admin.yourcompany.com/setup` to create the first platform owner.

## 5. A new release

```bash
su - dealer && cd ~/dealer-platform
git pull                                   # or upload the changed files
npm run install:all
(cd backend && npx prisma db push)
npm run build
pm2 reload ecosystem.config.cjs            # the API closes the Facebook browsers cleanly; logins stay saved
```

## How FB Poster behaves on the server

* **First time:** the dealer opens **FB Poster › Connect Facebook** and logs in once in the browser shown in the portal,
  answering Facebook's security check if it asks. The login is saved on the server in
  `backend/storage/facebook/profiles/<dealer>/<user>/`.
* **After that:** **Post to Facebook** and **Post to Facebook Marketplace** in Inventory work with one click. If that
  dealer's Chrome is asleep, the server starts it with the saved login (a few seconds), posts, and closes it again
  after 10 minutes without use.
* **Saving memory:** Chromes start in a lighter mode. Unused ones close after 10 minutes, and busy servers close other
  dealers' idle ones first. When memory is low, new posts wait up to about 40 seconds for a free slot. Every Chrome is
  restarted after 6 hours, and the live picture stream stops when nobody is watching. Every 5 minutes a frozen Chrome is
  detected, closed and started again on the next post. After a crash or restart, leftover Chromes and profile locks
  are cleaned up automatically.
* **One task at a time per dealer:** a group post that starts while a Marketplace listing is being filled in waits for
  it and then runs, instead of failing.
* **If Facebook ends a login** (password change, security check): the Inventory popup shows "Facebook asks to log in
  again" with a button to FB Poster. The dealer logs in once more and everything works again.

### Useful commands
```bash
pm2 status                 # are the 4 apps running?
pm2 logs api --lines 100   # API + FB Poster messages
pm2 monit                  # memory / CPU per app
free -m                    # server memory
```

### Backups (daily cron as root)
```bash
sudo -u postgres pg_dump dealer_platform | gzip > /root/backup/db-$(date +%F).sql.gz
tar czf /root/backup/files-$(date +%F).tgz -C /home/dealer/dealer-platform/backend uploads storage
```
`storage/` holds the saved Facebook logins: keep it private.

### If Facebook keeps asking for security checks
Facebook sees the server's IP address, which belongs to a data centre. Give the dealer a residential proxy in
**FB Poster › proxy (shield button)**. Their Chrome then uses it from the next start.
