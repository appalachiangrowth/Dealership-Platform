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
