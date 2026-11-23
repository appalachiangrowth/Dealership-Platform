/**
 * Platform Admin › Pages & SEO — the section types a page can be built from.
 * The website draws them (frontend/lib/custom-pages.ts) inside the dealership's theme.
 */

export type Section = { id: string; type: string; tone?: string; pad?: string; [k: string]: any };

export const newId = () => Math.random().toString(36).slice(2, 10);

export interface SectionDef {
  type: string;
  label: string;
  icon: string;
  desc: string;
  make: () => Omit<Section, 'id'>;
}

export const SECTION_DEFS: SectionDef[] = [
  {
    type: 'hero',
    label: 'Page header (hero)',
    icon: '🏁',
    desc: 'Big headline at the top of the page, with an optional background picture and buttons.',
    make: () => ({ type: 'hero', eyebrow: '', title: 'Page *headline*', text: 'A short sentence that tells visitors what this page is about.', buttons: [{ label: 'Browse inventory', link: 'inventory' }], height: 'm', align: 'left', image: '', overlay: 55 }),
  },
  {
    type: 'header',
    label: 'Custom header',
    icon: '🎨',
    desc: 'A page header you design yourself: background colour, gradient or picture, text colour, alignment, height, buttons and custom HTML / CSS.',
    make: () => ({
      type: 'header',
      eyebrow: '',
      title: 'Your *custom* header',
      subtitle: 'A short line under the heading.',
      bg: 'gradient',
      bgColor: '#0F172A',
      gradFrom: '#0F172A',
      gradTo: '#2563EB',
      gradAngle: 135,
      image: '',
      imagePos: 'center',
      overlay: 50,
      textColor: 'auto',
      accent: '',
      align: 'left',
      height: 'm',
      width: 'narrow',
      level: 'h1',
      buttons: [{ label: 'Browse inventory', link: 'inventory' }],
      html: '',
      css: '',
    }),
  },
  {
    type: 'text',
    label: 'Text',
    icon: '📝',
    desc: 'Headings (H1–H6) with formatted text: bold, italic, underline, highlight, lists and links.',
    make: () => ({
      type: 'text',
      eyebrow: '',
      content: [
        { id: newId(), kind: 'heading', level: 'h2', text: 'Section heading' },
        { id: newId(), kind: 'text', html: '<p>Write your text here. Use the toolbar for <strong>bold</strong>, <em>italic</em>, lists and links.</p>' },
      ],
      width: 'narrow',
      align: 'left',
    }),
  },
  {
    type: 'split',
    label: 'Picture + text',
    icon: '🖼️',
    desc: 'Headings and formatted text next to a picture (picture left or right).',
    make: () => ({
      type: 'split',
      eyebrow: '',
      content: [
        { id: newId(), kind: 'heading', level: 'h2', text: 'Why choose {name}' },
        { id: newId(), kind: 'text', html: '<p>Tell your story here.</p>' },
      ],
      image: '',
      imageSide: 'right',
      buttons: [{ label: 'Contact us', link: 'contact' }],
    }),
  },
  {
    type: 'cards',
    label: 'Feature cards',
    icon: '🧩',
    desc: 'Two to four cards with an icon, a title and a short text.',
    make: () => ({
      type: 'cards',
      eyebrow: '',
      title: 'What we offer',
      intro: '',
      columns: 3,
      items: [
        { icon: '✅', title: 'Inspected vehicles', text: 'Every car is checked before it goes on the lot.' },
        { icon: '💰', title: 'Fair prices', text: 'Clear prices, no hidden fees.' },
        { icon: '🤝', title: 'Friendly team', text: 'We help you find the right car.' },
      ],
    }),
  },
  {
    type: 'inventory',
    label: 'Vehicles from inventory',
    icon: '🚗',
    desc: "The dealership's live vehicles. Filter by body style, make, featured or price. Updates by itself.",
    make: () => ({ type: 'inventory', eyebrow: 'In stock now', title: 'Featured *vehicles*', intro: '', filter: { category: '', make: '', featured: false, sort: '' }, limit: 6, columns: 3, showButton: true, buttonLabel: 'View all inventory' }),
  },
  {
    type: 'cta',
    label: 'Call to action',
    icon: '📣',
    desc: 'A coloured band with a short message and buttons.',
    make: () => ({ type: 'cta', title: 'Ready to find your next car?', text: 'Browse our inventory or give us a call — we are happy to help.', buttons: [{ label: 'View inventory', link: 'inventory' }, { label: 'Call {phone}', link: 'call', style: 'ghost' }] }),
  },
  {
    type: 'stats',
    label: 'Numbers',
    icon: '🔢',
    desc: 'Big numbers with a label (e.g. "500+ happy drivers").',
    make: () => ({ type: 'stats', title: '', items: [{ value: '500+', label: 'Happy drivers' }, { value: '15', label: 'Years in business' }, { value: '4.9★', label: 'Google rating' }] }),
  },
  {
    type: 'testimonials',
    label: 'Reviews',
    icon: '⭐',
    desc: 'Customer quotes with a name.',
    make: () => ({ type: 'testimonials', title: 'What our customers say', items: [{ quote: 'Great experience from start to finish.', name: 'Customer name', detail: '' }] }),
  },
  {
    type: 'faq',
    label: 'Questions & answers',
    icon: '❓',
    desc: 'Questions that open to show the answer.',
    make: () => ({ type: 'faq', title: 'Frequently asked questions', items: [{ q: 'Do you offer financing?', a: 'Yes. We work with several lenders.' }] }),
  },
  {
    type: 'gallery',
    label: 'Picture gallery',
    icon: '🗂️',
    desc: 'A grid of pictures.',
    make: () => ({ type: 'gallery', title: '', images: [], columns: 3 }),
  },
  {
    type: 'form',
    label: 'Contact form',
    icon: '✉️',
    desc: 'Name, email, phone and message. Messages arrive in the dealership\'s Leads & inquiries.',
    make: () => ({ type: 'form', eyebrow: 'Get in touch', title: 'Send us a message', text: 'We usually reply within one business day.', topic: 'Website inquiry', buttonLabel: 'Send message', showPhone: true }),
  },
  {
    type: 'map',
    label: 'Map & contact details',
    icon: '📍',
    desc: "Google map of the dealership with its address, phone, email and hours (from Business details).",
    make: () => ({ type: 'map', title: 'Visit us', text: '', buttons: [{ label: 'Get directions', link: 'directions' }] }),
  },
  {
    type: 'html',
    label: 'Custom HTML / embed',
    icon: '🧾',
    desc: 'Paste HTML or an embed code (video, calculator, booking widget).',
    make: () => ({ type: 'html', html: '' }),
  },
  {
    type: 'spacer',
    label: 'Space / divider',
    icon: '↕️',
    desc: 'Empty space, optionally with a line.',
    make: () => ({ type: 'spacer', size: 'm', line: false }),
  },
];

export const DEF = Object.fromEntries(SECTION_DEFS.map((d) => [d.type, d])) as Record<string, SectionDef>;

export const make = (type: string): Section => ({ id: newId(), ...(DEF[type]?.make() || { type }) }) as Section;

/** Quick link targets — they follow the theme (e.g. "inventory" opens the theme's inventory page). */
export const LINKS: [string, string][] = [
  ['inventory', 'Inventory page'],
  ['contact', 'Contact page'],
  ['about', 'About page'],
  ['home', 'Home page'],
  ['call', 'Call the dealership'],
  ['email', 'Email the dealership'],
  ['directions', 'Directions (Google Maps)'],
  ['category:cars', 'Used cars'],
  ['category:sedans', 'Sedans'],
  ['category:suvs', 'SUVs'],
  ['category:trucks', 'Trucks'],
  ['category:wagons', 'Wagons'],
];

/** Header menu: quick links that follow the theme (inventory page, body style pages …) */
export const MENU_LINKS: [string, string][] = [
  ['inventory', 'Inventory page'],
  ['contact', 'Contact page'],
  ['about', 'About page'],
  ['home', 'Home page'],
  ['category:cars', 'Used cars'],
  ['category:sedans', 'Sedans'],
  ['category:suvs', 'SUVs'],
  ['category:trucks', 'Trucks'],
  ['category:wagons', 'Wagons'],
];

/** one entry of a website's header menu (Pages & SEO › Header menu) */
export type MenuItem = {
  id: string;
  /** default = a standard page of the design (Home, Inventory …): its address is locked */
  type: 'page' | 'default' | 'group' | 'link';
  slug?: string;
  /** default pages: home | inventory | used-cars … */
  key?: string;
  url?: string;
  label: string;
  hidden: boolean;
  children?: MenuItem[];
};

/** a standard page of the design (from the API: key, label, quick link) */
export type DefaultPage = { key: string; label: string; url: string };

/** one footer link (Pages & SEO › Footer) */
export type FooterLink = {
  id: string;
  type: 'page' | 'default' | 'link';
  slug?: string;
  key?: string;
  url?: string;
  label: string;
  newTab: boolean;
};
/** one footer column: heading + links */
export type FooterColumn = { id: string; heading: string; hidden: boolean; links: FooterLink[] };

/** Text / Picture & Text content: headings (H1–H6) and formatted text, in order */
export type ContentBlock = { id: string; kind: 'heading'; level: string; text: string } | { id: string; kind: 'text'; html: string };

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** quick link of an old section ("contact", "category:suvs") → the link form of the rich text ("#pa:contact") */
export const quickHref = (u: string) => (/^(inventory|contact|about|home|call|email|directions|category:[a-z]+)$/.test(u) ? `#pa:${u}` : u);

/**
 * The simple formatting of sections saved before (paragraphs, "- " lists, "## " headings, **bold**, *italic*,
 * [text](link)) as formatted text, so an old section opens in the new editor looking the same.
 */
export function markdownToHtml(src: string): string {
  const inline = (s: string) =>
    escHtml(s)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (_m, label: string, url: string) => {
        const href = quickHref(url.replace(/&amp;/g, '&'));
        return `<a href="${escHtml(href)}"${/^https?:/i.test(href) ? ' target="_blank"' : ''}>${label}</a>`;
      });
  return String(src || '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('') + '</ul>';
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return '<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('') + '</ol>';
      return lines
        .map((l) => {
          const hd = l.match(/^\s*#{2,3}\s+(.+)$/);
          return hd ? `<h3>${inline(hd[1])}</h3>` : `<p>${inline(l)}</p>`;
        })
        .join('');
    })
    .join('');
}

/** the headings + text of a Text / Picture & Text section (an old section: its heading + text, converted) */
export function contentOf(s: Section): ContentBlock[] {
  if (Array.isArray(s.content)) return s.content as ContentBlock[];
  // ids from the section's own id: stable across renders until the first change saves the blocks
  const out: ContentBlock[] = [];
  if (s.title) out.push({ id: `${s.id}h`, kind: 'heading', level: 'h2', text: String(s.title) });
  if (s.body) out.push({ id: `${s.id}t`, kind: 'text', html: markdownToHtml(String(s.body)) });
  if (!out.length) out.push({ id: `${s.id}t`, kind: 'text', html: '' });
  return out;
}

export const CATEGORIES: [string, string][] = [
  ['', 'All body styles'],
  ['cars', 'Cars'],
  ['sedans', 'Sedans'],
  ['suvs', 'SUVs'],
  ['trucks', 'Trucks'],
  ['wagons', 'Wagons'],
  ['vans', 'Vans'],
];

export const TONES: [string, string][] = [
  ['', 'Automatic'],
  ['page', 'Page background'],
  ['alt', 'Light tint'],
  ['dark', 'Dark'],
  ['brand', 'Brand colour'],
];

export const TOKENS = '{name} {phone} {email} {city} {state} {city_state} {address} {hours_week} {hours_weekend} {site_url}';

/** Starting points for a new page */
export const TEMPLATES: { id: string; label: string; desc: string; slug: string; title: string; sections: () => Section[]; seo?: { title: string; description: string } }[] = [
  { id: 'blank', label: 'Blank page', desc: 'Start with a page header only.', slug: '', title: '', sections: () => [make('hero')] },
  {
    id: 'financing',
    label: 'Financing',
    desc: 'Steps, featured vehicles, FAQ and an application form.',
    slug: 'financing',
    title: 'Financing',
    seo: { title: 'Car Financing in {city_state} | {name}', description: 'Get pre-approved for your next vehicle at {name}. Options for every credit situation.' },
    sections: () => [
      { ...make('hero'), eyebrow: 'Financing made easy', title: 'Drive home *today* with financing that fits', text: 'Good credit, bad credit or no credit — {name} works with local lenders to find a payment that works for you.', buttons: [{ label: 'Get pre-approved', link: '#pa-s-4' }, { label: 'Call {phone}', link: 'call', style: 'ghost' }] },
      { ...make('cards'), eyebrow: 'How it works', title: 'Three simple steps', items: [{ icon: '📝', title: 'Apply', text: 'Fill in a short form — about two minutes.' }, { icon: '🤝', title: 'Get approved', text: 'We shop your application with our lending partners.' }, { icon: '🚗', title: 'Drive home', text: 'Pick any vehicle on our lot and drive it home.' }] },
      { ...make('inventory'), tone: 'alt', eyebrow: 'Ready to go', title: 'Popular *vehicles*', limit: 3 },
      { ...make('faq'), items: [{ q: 'Can I get financing with bad credit?', a: 'Yes. We work with lenders who help buyers in every credit situation.' }, { q: 'Do I need a down payment?', a: 'Not always — it depends on the lender and the vehicle.' }, { q: 'Can I trade in my current car?', a: 'Yes. Your trade-in can go towards your down payment.' }] },
      { ...make('form'), eyebrow: 'Get pre-approved', title: 'Start your application', topic: 'Financing request', buttonLabel: 'Send application' },
    ],
  },
  {
    id: 'trade-in',
    label: 'Trade-in / sell your car',
    desc: 'Explains the trade-in process with a request form.',
    slug: 'trade-in',
    title: 'Trade-in',
    seo: { title: 'Trade In or Sell Your Car | {name}', description: 'Get a fair offer for your vehicle at {name} in {city_state}.' },
    sections: () => [
      { ...make('hero'), eyebrow: 'Trade-in', title: 'Get a *fair offer* for your car', text: 'Trade in towards your next vehicle or simply sell it to us.', buttons: [{ label: 'Request an offer', link: '#pa-s-2' }] },
      { ...make('split'), title: 'Quick, honest and easy', body: '- Free appraisal\n- Same-day offer\n- We handle the paperwork' },
      { ...make('form'), eyebrow: 'Your vehicle', title: 'Tell us about your car', text: 'Year, make, model, mileage and condition help us give you an accurate offer.', topic: 'Trade-in request', buttonLabel: 'Request my offer' },
    ],
  },
  {
    id: 'landing',
    label: 'Vehicle landing page',
    desc: 'Header, filtered vehicles and a call to action — e.g. "Trucks under $20,000".',
    slug: 'trucks-for-sale',
    title: 'Trucks for sale',
    seo: { title: 'Used Trucks for Sale in {city_state} | {name}', description: 'Browse used trucks for sale at {name} in {city_state}.' },
    sections: () => [
      { ...make('hero'), height: 's', eyebrow: '{city_state}', title: 'Used *trucks* for sale', text: 'Work-ready pickups, inspected and priced right.' },
      { ...make('inventory'), title: 'Trucks in stock', eyebrow: '', filter: { category: 'trucks', make: '', featured: false, sort: 'price_asc' }, limit: 12 },
      make('cta'),
    ],
  },
  {
    id: 'about',
    label: 'About / our story',
    desc: 'Story, numbers, reviews and a map.',
    slug: 'our-story',
    title: 'Our story',
    sections: () => [make('hero'), make('split'), make('stats'), make('testimonials'), make('map')],
  },
];
