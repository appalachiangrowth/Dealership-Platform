/**
 * Photo Studio backgrounds: 8 dealership scenes drawn on this server (SVG → JPEG with sharp), so they never depend
 * on an outside link. Every scene is drawn for any size / aspect ratio (wide scenes are cropped in the middle).
 *
 * For each scene:
 *  ground      where the tyres stand, as a share of the height (the floor / road at that line)
 *  maxW, maxH  the largest share of the width / height the vehicle may take
 *  reflection  strength of the mirror image on a shiny floor (0 = none)
 *  shadow      darkness of the ground shadow (contact + soft ambient)
 *  blur        depth-of-field blur of the background (outdoor scenes), in % of the width
 *  exposure    small brightness match of the vehicle to the scene's light (±, applied as a gain; paint hue kept)
 */
export interface StudioPreset {
  id: string;
  name: string;
  desc: string;
  ground: number;
  maxW: number;
  maxH: number;
  reflection: number;
  shadow: number;
  blur: number;
  exposure: number;
  svg: (w: number, h: number) => string;
}

export const DEFAULT_PRESET = 'cyclorama';
/** the cut-out vehicle on its own (PNG with transparency) */
export const TRANSPARENT = 'transparent';
/** a photo the dealer uploaded (their own showroom wall or lot) */
export const CUSTOM = 'custom';

/** scenes are designed on a 1600 × 1200 canvas; other sizes crop / extend around the middle (slice) */
const VB_W = 1600;
const VB_H = 1200;

const svg = (w: number, h: number, body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;

/** a row of soft ceiling light panels in perspective */
function ceilingPanels(y0: number, y1: number, rows: number, cols: number, color: string, opacity: number) {
  let out = '';
  for (let r = 0; r < rows; r++) {
    const t = r / Math.max(1, rows - 1);
    const y = y0 + (y1 - y0) * t * t;
    const pw = 120 + 120 * t;
    const ph = 10 + 18 * t;
    const spread = 520 + 640 * t;
    for (let c = 0; c < cols; c++) {
      const x = VB_W / 2 - spread + ((2 * spread) / Math.max(1, cols - 1)) * c - pw / 2;
      out += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${pw.toFixed(0)}" height="${ph.toFixed(0)}" rx="4" fill="${color}" opacity="${opacity}" filter="url(#glow)"/>`;
    }
  }
  return out;
}

const GLOW = '<filter id="glow" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>';
const SOFT = '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>';

export const PRESETS: StudioPreset[] = [
  {
    id: 'showroom',
    name: 'Luxury Showroom',
    desc: 'Polished concrete floor, LED ceiling panels, clean walls',
    ground: 0.86, maxW: 0.8, maxH: 0.6, reflection: 0.2, shadow: 0.55, blur: 0, exposure: 0.01,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#wall)"/>
         <rect y="0" width="1600" height="300" fill="url(#ceil)"/>
         ${ceilingPanels(40, 250, 3, 5, '#ffffff', 0.95)}
         <rect x="0" y="300" width="1600" height="400" fill="url(#wall2)"/>
         <rect x="120" y="360" width="420" height="300" fill="#dfe3e8"/><rect x="1060" y="360" width="420" height="300" fill="#dfe3e8"/>
         <rect x="600" y="330" width="400" height="330" fill="url(#glass)"/>
         <rect x="0" y="650" width="1600" height="14" fill="#c3c8cf"/>
         <rect y="664" width="1600" height="536" fill="url(#floor)"/>
         <ellipse cx="800" cy="900" rx="760" ry="200" fill="#ffffff" opacity="0.13" filter="url(#soft)"/>`,
        `${GLOW}${SOFT}
         <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ecef"/><stop offset="1" stop-color="#d4d8dd"/></linearGradient>
         <linearGradient id="ceil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd4da"/><stop offset="1" stop-color="#e6e9ec"/></linearGradient>
         <linearGradient id="wall2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f2"/><stop offset="1" stop-color="#e1e4e8"/></linearGradient>
         <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0ea"/><stop offset="1" stop-color="#e9f1f5"/></linearGradient>
         <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9aeb4"/><stop offset="0.35" stop-color="#b9bdc2"/><stop offset="1" stop-color="#8d9298"/></linearGradient>`,
      ),
  },
  {
    id: 'cyclorama',
    name: 'White Cyclorama Studio',
    desc: 'Bright infinity studio, soft floor reflection',
    ground: 0.84, maxW: 0.84, maxH: 0.66, reflection: 0.12, shadow: 0.5, blur: 0, exposure: 0.015,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#cyc)"/>
         <ellipse cx="800" cy="1010" rx="900" ry="260" fill="#ffffff" opacity="0.9" filter="url(#soft)"/>`,
        `${SOFT}<linearGradient id="cyc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f7f8f9"/><stop offset="0.72" stop-color="#eceef0"/><stop offset="1" stop-color="#f6f7f8"/></linearGradient>`,
      ),
  },
  {
    id: 'boutique',
    name: 'Wood & Glass Boutique',
    desc: 'Warm upscale showroom, wood panels and glass',
    ground: 0.86, maxW: 0.8, maxH: 0.6, reflection: 0.16, shadow: 0.6, blur: 0, exposure: 0,
    svg: (w, h) => {
      let slats = '';
      for (let i = 0; i < 22; i++) slats += `<rect x="${i * 74}" y="250" width="62" height="420" fill="url(#wood)" opacity="${0.85 + (i % 3) * 0.05}"/>`;
      return svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="#3a2a1f"/>
         <rect width="1600" height="250" fill="url(#ceilw)"/>
         ${ceilingPanels(70, 210, 2, 6, '#ffe2b0', 0.9)}
         ${slats}
         <rect x="980" y="250" width="620" height="420" fill="url(#glassw)"/>
         <rect x="980" y="250" width="6" height="420" fill="#2b2118"/><rect x="1290" y="250" width="6" height="420" fill="#2b2118"/>
         <ellipse cx="420" cy="330" rx="260" ry="120" fill="#ffcf8a" opacity="0.35" filter="url(#soft)"/>
         <rect y="670" width="1600" height="530" fill="url(#floorw)"/>
         <ellipse cx="800" cy="920" rx="740" ry="190" fill="#ffd9a6" opacity="0.09" filter="url(#soft)"/>`,
        `${GLOW}${SOFT}
         <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a35"/><stop offset="1" stop-color="#6b4227"/></linearGradient>
         <linearGradient id="ceilw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1f17"/><stop offset="1" stop-color="#4a3626"/></linearGradient>
         <linearGradient id="glassw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6f7f86"/><stop offset="1" stop-color="#9aa6a8"/></linearGradient>
         <linearGradient id="floorw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7765"/><stop offset="0.4" stop-color="#7d6655"/><stop offset="1" stop-color="#5a4638"/></linearGradient>`,
      );
    },
  },
  {
    id: 'dark-studio',
    name: 'Dark Performance Studio',
    desc: 'Charcoal studio, dramatic overhead light strips',
    ground: 0.85, maxW: 0.82, maxH: 0.62, reflection: 0.24, shadow: 0.75, blur: 0, exposure: -0.02,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#dk)"/>
         <rect x="260" y="60" width="1080" height="16" rx="8" fill="#ffffff" opacity="0.95" filter="url(#glow)"/>
         <rect x="360" y="130" width="880" height="12" rx="6" fill="#ffffff" opacity="0.8" filter="url(#glow)"/>
         <polygon points="300,76 1300,76 1520,700 80,700" fill="url(#beam)"/>
         <rect y="700" width="1600" height="500" fill="url(#dkfloor)"/>
         <ellipse cx="800" cy="930" rx="700" ry="170" fill="#9aa3ad" opacity="0.14" filter="url(#soft)"/>`,
        `${GLOW}${SOFT}
         <radialGradient id="dk" cx="0.5" cy="0.35" r="0.8"><stop offset="0" stop-color="#3a3f45"/><stop offset="1" stop-color="#121417"/></radialGradient>
         <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
         <linearGradient id="dkfloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3035"/><stop offset="0.5" stop-color="#22252a"/><stop offset="1" stop-color="#15171a"/></linearGradient>`,
      ),
  },
  {
    id: 'outdoor-lot',
    name: 'Outdoor Dealership Lot',
    desc: 'Clean asphalt lot, modern building, blue sky',
    ground: 0.86, maxW: 0.8, maxH: 0.6, reflection: 0, shadow: 0.7, blur: 0.25, exposure: 0.01,
    svg: (w, h) => {
      let windows = '';
      for (let i = 0; i < 9; i++) windows += `<rect x="${250 + i * 124}" y="330" width="104" height="190" fill="url(#bwin)"/>`;
      let lines = '';
      for (let i = -6; i <= 6; i++) lines += `<line x1="${800 + i * 150}" y1="640" x2="${800 + i * 420}" y2="1200" stroke="#f1f1ee" stroke-width="7" opacity="0.55"/>`;
      return svg(
        w,
        h,
        `<rect width="1600" height="640" fill="url(#sky)"/>
         <ellipse cx="300" cy="160" rx="220" ry="40" fill="#ffffff" opacity="0.7" filter="url(#soft)"/>
         <ellipse cx="1250" cy="110" rx="260" ry="46" fill="#ffffff" opacity="0.6" filter="url(#soft)"/>
         <rect x="200" y="280" width="1200" height="360" fill="#e8eaec"/>
         <rect x="200" y="280" width="1200" height="34" fill="#c9ced3"/>
         ${windows}
         <rect x="0" y="560" width="1600" height="80" fill="#7c9a62"/>
         <rect y="640" width="1600" height="560" fill="url(#asph)"/>
         ${lines}`,
        `${SOFT}
         <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f86d6"/><stop offset="1" stop-color="#a9d1f4"/></linearGradient>
         <linearGradient id="bwin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5f7f99"/><stop offset="1" stop-color="#a7c0d2"/></linearGradient>
         <linearGradient id="asph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d7075"/><stop offset="1" stop-color="#45484c"/></linearGradient>`,
      );
    },
  },
  {
    id: 'mountain',
    name: 'Scenic Mountain Overlook',
    desc: 'Paved pull-off, mountains and crisp daylight sky',
    ground: 0.87, maxW: 0.8, maxH: 0.6, reflection: 0, shadow: 0.7, blur: 0.4, exposure: 0.01,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="700" fill="url(#msky)"/>
         <polygon points="0,560 180,360 330,470 520,250 700,430 860,300 1040,470 1220,280 1400,420 1600,330 1600,700 0,700" fill="url(#m1)"/>
         <polygon points="300,320 520,250 600,320 520,300" fill="#f4f6f8" opacity="0.9"/>
         <polygon points="1150,330 1220,280 1290,330 1220,315" fill="#f4f6f8" opacity="0.9"/>
         <polygon points="0,640 260,500 480,600 760,480 1000,600 1260,500 1600,610 1600,720 0,720" fill="url(#m2)"/>
         <rect y="690" width="1600" height="80" fill="#5c7a48"/>
         <rect y="760" width="1600" height="440" fill="url(#road)"/>
         <rect y="760" width="1600" height="10" fill="#d9d6cf" opacity="0.8"/>`,
        `<linearGradient id="msky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4b8fd8"/><stop offset="1" stop-color="#cfe6f8"/></linearGradient>
         <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8aa0b6"/><stop offset="1" stop-color="#a9bccb"/></linearGradient>
         <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d7a5a"/><stop offset="1" stop-color="#4b6648"/></linearGradient>
         <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a7b7d"/><stop offset="1" stop-color="#525356"/></linearGradient>`,
      ),
  },
  {
    id: 'urban-plaza',
    name: 'Urban Glass Plaza',
    desc: 'Architectural concrete plaza, overcast daylight',
    ground: 0.86, maxW: 0.8, maxH: 0.6, reflection: 0.06, shadow: 0.6, blur: 0.3, exposure: 0.01,
    svg: (w, h) => {
      let towers = '';
      const T = [[60, 120, 300], [380, 40, 260], [660, 160, 280], [960, 70, 300], [1280, 140, 280]];
      for (const [x, y, tw] of T) {
        towers += `<rect x="${x}" y="${y}" width="${tw}" height="${640 - y}" fill="url(#tower)"/>`;
        for (let r = y + 20; r < 620; r += 38) towers += `<rect x="${x}" y="${r}" width="${tw}" height="3" fill="#8a96a0" opacity="0.6"/>`;
        for (let c = x + 40; c < x + tw; c += 60) towers += `<rect x="${c}" y="${y}" width="3" height="${640 - y}" fill="#8a96a0" opacity="0.45"/>`;
      }
      let tiles = '';
      for (let i = -8; i <= 8; i++) tiles += `<line x1="${800 + i * 120}" y1="640" x2="${800 + i * 360}" y2="1200" stroke="#9fa3a6" stroke-width="3" opacity="0.5"/>`;
      for (let r = 0; r < 7; r++) tiles += `<line x1="0" y1="${660 + r * r * 13}" x2="1600" y2="${660 + r * r * 13}" stroke="#9fa3a6" stroke-width="3" opacity="0.45"/>`;
      return svg(
        w,
        h,
        `<rect width="1600" height="640" fill="url(#over)"/>${towers}
         <rect y="640" width="1600" height="560" fill="url(#plaza)"/>${tiles}`,
        `<linearGradient id="over" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4cbd2"/><stop offset="1" stop-color="#e2e6ea"/></linearGradient>
         <linearGradient id="tower" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fb0bf"/><stop offset="1" stop-color="#cdd7df"/></linearGradient>
         <linearGradient id="plaza" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2c4c5"/><stop offset="1" stop-color="#a3a6a8"/></linearGradient>`,
      );
    },
  },
  {
    id: 'gray-studio',
    name: 'Neutral Gray Studio',
    desc: 'Minimal light-gray catalog backdrop',
    ground: 0.84, maxW: 0.84, maxH: 0.66, reflection: 0.08, shadow: 0.55, blur: 0, exposure: 0.01,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#gy)"/><rect width="1600" height="1200" fill="url(#gyl)"/>`,
        `<radialGradient id="gyl" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><linearGradient id="gy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e1e3e5"/><stop offset="0.68" stop-color="#d2d5d8"/><stop offset="1" stop-color="#c3c6ca"/></linearGradient>`,
      ),
  },
];

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

/** layout used for a custom (uploaded) background and for the transparent cut-out */
export const CUSTOM_LAYOUT: Omit<StudioPreset, 'svg' | 'id' | 'name' | 'desc'> = {
  ground: 0.86, maxW: 0.8, maxH: 0.62, reflection: 0, shadow: 0.6, blur: 0, exposure: 0,
};
export const TRANSPARENT_LAYOUT: Omit<StudioPreset, 'svg' | 'id' | 'name' | 'desc'> = {
  ground: 0.9, maxW: 0.92, maxH: 0.8, reflection: 0, shadow: 0.35, blur: 0, exposure: 0,
};
