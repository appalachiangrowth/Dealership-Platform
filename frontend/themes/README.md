# Building a design (theme)

A theme is a folder `themes/<theme-id>/<version>/` (e.g. `themes/showroom/1.0.0/`):

```
theme.json        manifest (copy an existing theme's and change it)
templates/        index.html (+ any other page, e.g. used-cars.html)
partials/         pieces used with {%include file.html%}
assets/           css, js, images, preview.jpg
```

## Rules
1. **No dealership data in a theme.** No names, phone numbers, addresses, sample vehicles, reviews, team
   members, statistics or claims. Use `{%site name%}`, `{%site phone%}`, `{%siteurl tel_link%}`,
   `{%siteurl maps_dir%}`, `{%siteurl logo%}` … (all keys: `pa_site_tokens()` in platform/lib/tenant.php).
   Empty details are shown as placeholders automatically ("Add phone number", a "Your logo" badge).
2. **Client text comes from the shared content list** in `platform/lib/content-schema.php`
   (`home.hero.title`, `home.why.f1_title`, `about.story.copy`, `home.reviews.r1_text`, `seo.home.title` …).
   Use those keys so a dealer's text follows them from theme to theme:
   `{%head home.hero.title%}`, `{%para about.story.copy%}`, `{%js home.reviews.r1_text%}` (for scripts).
   If your template already uses another key with the same meaning, map it in theme.json:
   `"content_map": {"about.story.p1": "about.story.copy"}`.
3. **Any other key is fixed design wording** (button labels, eyebrows): `{%text home.hero.btn label="" | Browse inventory%}`.
   It is rendered with its default and is not shown in the editor.
4. Wrap optional blocks with `{%show content.home.reviews.r2_text%} … {%endshow%}` so they disappear when
   the dealer leaves that text empty, and with `{%if site.facebook%} … {%endif%}` for optional details
   (`{%if%}` blocks cannot be nested).
5. Page scripts load vehicles and blog posts from `inventory.json` (relative URL) and post inquiries to
   `api/lead.php`. Show a friendly message when there are no vehicles or posts — never sample data.
6. Include `{%raw DESIGN%}{%raw SITE_JSON%}` in `<head>` (plus the SEO markers, see an existing theme) and
   `{%raw PREVIEW_BAR%}` before `</body>`.
7. In `theme.json` list every public page (`pages`), the brand colour CSS variables (`design.colors`, with
   `also` for linked variables), a `preview` image (1440 × 900 hero screenshot, saved at 960 × 600) and a
   short `style` label for the admin gallery. Single-page themes add `hash_routes` so the editor preview can
   open the right section (`"about": "#about-page"`).

## Releasing
Upload the folder or a ZIP (Platform console → Themes & releases), set Beta, test, then set Stable.
Dealers switch designs themselves in Design & colours; their text, vehicles and settings stay.

## Theme ZIP upload
A ZIP must include exactly one `theme.json`, page templates under `templates/`, and optional `partials/` and
`assets/`. The manifest's `id` and `version` decide the install folder `themes/<id>/<version>/`. Existing
versions are never overwritten. See `INSTALL-THEME-ZIP-INSTALLER.md` for the full format and safety rules.

## Custom pages (Platform Admin › Pages & SEO)
Custom pages are drawn inside your theme: the website takes one of your page templates, keeps its `<head>`, header,
footer and scripts, and puts the page's sections where the main content was. The built-in themes are described in
`frontend/lib/custom-pages.ts` (THEME_KITS). Custom pages follow EVERY installed design automatically — a new design,
a new version, or a design deleted and installed again — without code changes:
- a design built from one of the built-in ones (same header/menus/content area, e.g. Velocity from Apex Drift) is
  recognised by its markup and gets that design's layout and styling;
- any other design: its header menu and mobile menu are found in its templates (a `<nav>`, or an element whose
  class/id says nav/menu/drawer/mobile, above the footer, linking to 2+ pages), the content goes inside its `<main>`
  (or between `</header>` and the last `<footer>`), and the colours come from its `design.colors`.

If a design's menus are unusual, it can describe itself in theme.json (this always wins):

```json
"custom_page": {
  "template": "about-us.html",
  "start": "<main id=\"main\">", "end": "</main>",
  "links": { "inventory": "inventory.html", "contact": "contact-us.html", "about": "about-us.html",
             "category": "used-{x}.html", "vehicle": "vehicle.html?id={id}" },
  "nav": [{ "open": "<nav class=\"main-nav\"", "item": "<a href=\"{href}\">{label}</a>" }],
  "vars": { "--pa-primary": "var(--brand)", "--pa-bg": "#fff", "--pa-fh": "var(--font-heading)" }
}
```

## Header menu & dropdowns (Platform Admin › Pages & SEO › Header menu)
The custom pages can be arranged as top-level links and dropdowns (e.g. "Financing" with 3–4 pages under it). The
website adds them after the theme's own links in every menu the custom pages use (see above):
- desktop menus get a dropdown — the theme's own dropdown markup when its kit has one (`dd` in THEME_KITS, e.g. the
  Apex Drift / Velocity `.nav-group` / `.nav-dropdown`), otherwise a shared `.pa-dd` dropdown whose colours are taken
  from the header it sits in (opens on hover, keyboard focus and tap);
- mobile / drawer menus (`mobile: true`, or detected by a class/id like mobile, drawer, offcanvas) list the dropdown's
  entries indented under its title.
A theme can describe its own dropdown in theme.json under `custom_page.nav[].dd`:
`{ "wrap": "<div class=\"has-sub\">{trigger}<div class=\"sub\">{items}</div></div>", "trigger": "<a href=\"{href}\">{label}</a>", "child": "<a href=\"{href}\">{label}</a>" }`
and mark its mobile menu with `"mobile": true`.

