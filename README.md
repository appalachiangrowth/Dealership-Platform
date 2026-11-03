# Dealer Platform 4.0 (Next.js · NestJS · Prisma · PostgreSQL)

The AGS Dealer Platform rebuilt on the same stack as Tabibistan. The old PHP + JSON-file version stays untouched in
`ags-dealer-platform-3.0.0 1`; a one-time script moves all of its data into the new database.

```
dealer-platform/
├─ dealer-portal/  Next.js 16 — Dealership Portal (/dealer) — the app given to dealers         :3000
├─ admin/          Next.js 16 — Platform Admin (/platform) — the main admin, platform owners    :3001
├─ frontend/       Next.js 16 — the public dealer websites (view only, every dealer domain)     :3002
│  ├─ themes/            the ORIGINAL design templates (unchanged)
│  └─ public/themes/     the ORIGINAL design CSS / JS / images / 3D models (unchanged)
└─ backend/        NestJS 12 + Prisma 7 + PostgreSQL — the API, feeds, CarGurus, e-mail         :4000
   └─ prisma/schema.prisma
```

The two admins are separate apps with separate logins. A platform owner can still work inside one dealership
("Open Dealership Portal" in Platform Admin › Dealerships): it opens that dealership in the Dealership Portal
in a new tab (support mode); "Back to Platform Admin" returns.

**Quick start on Windows:** double-click `start-all.cmd` (creates the settings on first run, then opens all four apps).

| Tabibistan | Dealer Platform |
|---|---|
| apps/web   | frontend |
| apps/admin | admin |
| apps/api   | backend |

## 1. First run

Needs Node.js 20+ and PostgreSQL 14+.

```bash
# database
createdb dealer_platform            # or create it in pgAdmin

# backend
cd backend
copy .env.example .env              # then edit DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate dev --name init  # creates all tables
npm run db:seed                     # adds the 5 website designs
npm run start:dev                   # http://localhost:4000

# dealership portal  (new terminal)
cd dealer-portal
copy rename-to-dot-env-local.txt .env.local
npm install
npm run dev                         # http://localhost:3000

# platform admin  (new terminal)
cd admin
copy rename-to-dot-env-local.txt .env.local
npm install
npm run dev                         # http://localhost:3001

# websites  (new terminal)
cd frontend
copy rename-to-dot-env-local.txt .env.local
npm install
npm run dev                         # http://<dealer-id>.localhost:3002
```

Open http://localhost:3001 (Platform Admin) → it asks you to create the **platform owner** (first run only) → add a dealership.
Dealers log in at http://localhost:3000 (Dealership Portal).
Each dealer website opens at `http://<dealer-id>.localhost:3002` on this computer (no hosts-file changes needed in
Chrome/Edge), and at its own domain in production.

## 2. Move the data from the old PHP platform (one time)

```bash
cd backend
# .env:  LEGACY_PATH="C:/Users/DELL/Documents/ags-dealer-platform-3.0.0 1"
npm run migrate:legacy
```

Moves platform owners, platform settings, design prices, every dealership with its domains, business details,
team logins (**same passwords** — the old bcrypt hashes still work), vehicles, blog posts, inquiries + replies,
website text + history, brand colours, design licences / requests, field rules, set-up progress, the activity log,
and copies all photos to `backend/uploads/<dealer>/`. Safe to run twice (existing dealers are skipped).
Not moved: CarGurus submissions — submit and approve them once in the new admin.

## 3. What maps to what

| Old (PHP) | New |
|---|---|
| `storage/*.json` files | PostgreSQL tables (see the header of `backend/prisma/schema.prisma`) |
| `api/*.php` | NestJS modules in `backend/src/*` |
| `platform-admin/` | `admin` → `/platform/*` (:3001) |
| `admin/` (Dealership Portal) | `dealer-portal` → `/dealer/*` (:3000) |
| `index.php` + `platform/lib/content.php` (template engine) | `frontend/app/[[...path]]/route.ts` + `frontend/lib/engine.ts` (TypeScript port) |
| `themes/<id>/<version>/` | `frontend/themes/` + `frontend/public/themes/` — the same files, byte for byte |
| `inventory.json`, `api/lead.php`, `logo`, `uploads/…`, `sitemap.xml`, `robots.txt`, `inventory.xml` | the same addresses, now served by Next.js |
| `platform/lib/content-schema.php` | `backend/src/content/content.schema.ts` (same keys and default texts) |
| `CarGurusIngestionService.php` | `backend/src/cargurus/ingestion.ts` (same 20 columns and checks) |
| `cron/cargurus-upload.php` | built-in daily job (`CARGURUS_CRON_HOUR` in backend `.env`) |
| PHP sessions + CSRF | Bearer tokens (JWT); platform owners open a dealer with "Open Dealership Portal" (support mode) |

### API overview (all JSON)
* `POST /auth/login`, `/auth/signup`, `/auth/setup`, `GET /auth/me`, `POST /auth/change-password`
* Dealership Portal (`/dealer/*`, permission-checked): `dashboard`, `settings`, `vehicles` (+ `bulk`, `import`, `field-rules`),
  `posts`, `leads` (+ `reply`, `email`, `export.csv`), `content` (+ `history`), `design` (+ `activate`, `colors`, `request`),
  `team`, `media`, `feeds` (+ `cargurus` upload / submit)
* Platform Admin (`/platform/*`, owners only): `overview`, `tenants`, `inventory`, `leads`, `accounts`, `owners`, `themes`,
  `theme-requests`, `cargurus` (audit / approve / reject / resend), `settings`, `activity`, `system`
* Public websites (`/public/*?host=dealer-domain`): `site`, `vehicles`, `posts`, `leads`, `sitemap`, `feeds/inventory.xml`, `feeds/cargurus.csv`

Roles and permissions are unchanged: Dealership admin, Sales staff, Inventory manager, Lead manager, Marketing & content,
Custom (`backend/src/common/permissions.ts`).

## 4. Production (Hostinger VPS or any Node host)

* Run the four apps with PM2 (`npm run build` then `npm start` in each folder) behind Nginx.
* `api.yourcompany.com` → backend :4000, `portal.yourcompany.com` → dealer-portal :3000, `admin.yourcompany.com` → admin :3001, **every dealer domain** → frontend :3002.
* Set `API_URL` (frontend) and `NEXT_PUBLIC_API_URL` (dealer-portal, admin) to the API address, `NEXT_PUBLIC_DEALER_PORTAL_URL` / `NEXT_PUBLIC_PLATFORM_ADMIN_URL` to the two admin addresses and `ADMIN_URL` (frontend) to both of them; `npx prisma migrate deploy` on each release.
* Shared hosting (PHP-only) cannot run Node apps — use a VPS.

## 5. The public websites look and work exactly as before
The five designs (Classic, Atelier, Apex Drift, Halcyon, VroomFox) are the original theme files — same HTML, CSS,
JavaScript, fonts, images and 3D models. Next.js renders them with a TypeScript port of the old template engine and
serves the same addresses the theme scripts use (`inventory.json`, `api/lead.php`, `logo`, `uploads/…`), so every page,
animation, filter, vehicle page and form works the same way. During the rebuild every page of every design was rendered
with the old PHP code and with the new engine for three dealerships and compared: the HTML is identical.

To add or update a design: put the new version folder in `frontend/themes/<id>/<version>/` (templates, partials,
theme.json) and its `assets/` in `frontend/public/themes/<id>/<version>/assets/`, then record the release in
Platform Admin › Themes & releases.

## 6. FB Poster (Facebook groups, Pages and Marketplace)
The old `fb-poster` app (Group Poster + Marketplace add-on) is built in: Dealership Portal › **FB Poster**
(switch it on per dealership with the `facebook` feature flag).

* Nothing runs on the dealer's computer. The backend starts one Chrome per dealer user on the **server**
  (Puppeteer, headless). The dealer sees that browser inside the portal ("Show browser"), logs in to Facebook there
  and answers Facebook's security checks there.
* The Facebook login (Chrome profile) is kept in `backend/storage/facebook/profiles/<dealership>/<user>/` — keep this
  folder private and backed up; it is in `.gitignore`. Groups, Pages, collections, posting runs and Marketplace
  listings are in the database (`FbAccount`, `FbCollection`, `FbPostRun`, `FbListing`).
* Marketplace uses the vehicles from Inventory (no second inventory). Marketplace settings: `TenantSettings.fbSettings`.
* Backend `.env` (all optional): `FB_MAX_BROWSERS=4` (Chromes at the same time), `FB_IDLE_MINUTES=15` (close an
  unused browser; the login is kept), `FB_STORAGE_DIR`, `CHROME_PATH` (use this Chrome), `FB_HEADLESS=false` (show
  the Chrome windows on the server, for debugging).
* **On a Linux VPS:** run `npx puppeteer browsers install chrome` once in `backend/` (or install Google Chrome), plus
  Chrome's libraries: `sudo apt-get install -y libnss3 libatk-bridge2.0-0 libgbm1 libxkbcommon0 libasound2 (libasound2t64 on Ubuntu 24) libxdamage1
  libxrandr2 libpango-1.0-0 libcairo2 fonts-liberation`. About 300–500 MB RAM per open Facebook browser.
* Facebook sees the server's internet address. If a login keeps getting security checks, set a proxy for it
  (shield button on the FB Poster page).
