# Page kit — custom pages for the dealer websites

One format for every page. A page made in this format is drawn **inside the dealership's current theme**
(its header, footer, fonts and colours) and follows any theme change automatically.

```
page-kit/
  page-template.json   copy this to start a new page
  pages/               your pages (one .json file per page)
  add-page.mjs         sends a page to the platform and publishes it
  .env                 your settings (copy .env.example)
```

## Workflow

1. Copy the template: `page-kit/page-template.json` → `page-kit/pages/trade-in.json`
2. Change `title`, `slug`, `seo` and the `sections` (see below). Pictures can be local files: `"image": "./img/hero.jpg"`.
3. Check it: `node page-kit/add-page.mjs page-kit/pages/trade-in.json --check`
4. Send it: `node page-kit/add-page.mjs page-kit/pages/trade-in.json`
   (`--draft` = save without publishing). Running it again with the same `slug` **updates** the page.

Settings: copy `.env.example` to `.env` and fill in the platform owner login. Needs Node 18+.

## The page file

| Field | Meaning |
|---|---|
| `title` | page name (≤120 chars) |
| `slug` | address: `trade-in` → `/trade-in` (a–z, 0–9, dashes; not a theme page name like `inventory`, `about-us`) |
| `tenantId` | `"all"` = every dealership, or one dealership id = only that website |
| `showInNav`, `navLabel`, `navOrder` | menu link in the theme header, its text, its position (low first) |
| `seo` | `title`, `description`, `image`, `noindex` |
| `sections` | the page content, top to bottom (max 80) |

`{name}`, `{phone}`, `{email}`, `{address}` in any text are replaced with each dealership's details.

## Sections

Every section: `type`, optional `tone` (`page` · `alt` · `dark` · `brand`), `pad` (`s` · `m` · `l` · `none`), `anchor`.
Most also take `eyebrow`, `title`, `intro`, `align: "center"`. In titles, `*word*` = brand colour.

| type | fields |
|---|---|
| `hero` | `title`, `text`, `image`, `overlay` 0–90, `height` s/m/l, `buttons` |
| `text` | `body`, `width: "wide"`, `buttons` |
| `split` | `body`, `image`, `imageAlt`, `imageSide: "left"`, `buttons` |
| `cards` | `columns` 2–4, `items: [{ icon, title, text, image, link, linkLabel }]` |
| `inventory` | `limit`, `columns`, `filter: { category, make, featured, minPrice, maxPrice, minYear, sort }`, `buttonLabel` |
| `cta` | `title`, `text`, `buttons` |
| `stats` | `items: [{ value, label }]` |
| `testimonials` | `items: [{ quote, name, detail }]` |
| `faq` | `items: [{ q, a }]` |
| `gallery` | `images: [ … ]`, `columns` |
| `form` | `text`, `topic`, `buttonLabel`, `showPhone` — arrives as a dealer inquiry |
| `map` | `text`, `buttons` — dealer address, phone, hours + map |
| `html` | `html` — your own design (rules below) |
| `spacer` | `size` s/m/l, `line: true` |

- `category`: cars · sedans · suvs · trucks · wagons · vans — `sort`: price_asc · price_desc · year_desc · mileage_asc
- **Buttons**: `[{ "label": "Apply", "link": "contact" }]` — first = main, others outlined (`"style": "ghost"`/`"primary"`).
  `link`: `inventory` · `contact` · `about` · `home` · `call` · `email` · `directions` · `category:suvs` · `page:trade-in` · any URL.
  These work in every theme.
- **Text** (`body`, `text`, FAQ `a`): blank line = paragraph, `## Heading`, `- list`, `1. list`, `**bold**`, `*italic*`, `[label](link)`.

## Your own design (`html` section)

Content only — no `<html>`, `<head>`, `<body>`, no Bootstrap/Tailwind. Prefix your own classes (`tr-…`).
**Never fixed colours or fonts** — use these, so it follows the theme:

| | |
|---|---|
| `--pa-primary` / `--pa-primary-hover` / `--pa-on-primary` | brand colour / hover / text on it |
| `--pa-accent` · `--pa-dark` | accent · dark colour |
| `--pa-bg` · `--pa-alt` · `--pa-card` | backgrounds |
| `--pa-text` · `--pa-head` · `--pa-muted` · `--pa-line` | text · headings · soft text · borders |
| `--pa-fh` · `--pa-fb` · `--pa-fe` | heading · body · label font |
| `--pa-radius` · `--pa-btn-radius` | corner rounding |

Tints: `color-mix(in srgb, var(--pa-primary) 12%, transparent)`. Ready-made classes: `pa-eyebrow`, `pa-title`,
`pa-hl`, `pa-intro`, `pa-btns` + `pa-btn` / `pa-btn pa-btn--ghost`, `pa-grid pa-cols-2|3|4`, `pa-card`, `pa-card-icon`,
`pa-center`, `pa-muted`. Put the standard parts (inventory, form, FAQ) in their own sections, not in HTML.
`--check` warns about fixed colours and fonts.
